//! Export pipeline. The webview renders each page to a base64 PNG; this module
//! packages those images into PDF (Flate image container), PPTX (Open Packaging
//! zip with one picture slide per page), or a PNG / zip of PNGs.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;

fn decode_pngs(pages: &[String]) -> Result<Vec<(Vec<u8>, u32, u32)>, String> {
    let mut images = Vec::new();
    for (index, b64) in pages.iter().enumerate() {
        let raw = base64_decode(b64)
            .ok_or_else(|| format!("Page {} is not valid base64", index + 1))?;
        let (bytes, width, height) = png_dimensions(&raw)
            .ok_or_else(|| format!("Page {} is not a valid PNG", index + 1))?;
        images.push((bytes, width, height));
    }
    if images.is_empty() {
        return Err("There is nothing to export yet — add something to a page first".into());
    }
    Ok(images)
}

fn png_dimensions(raw: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    if raw.len() < 24 || &raw[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes([raw[16], raw[17], raw[18], raw[19]]);
    let height = u32::from_be_bytes([raw[20], raw[21], raw[22], raw[23]]);
    Some((raw.to_vec(), width, height))
}

fn slug(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' })
        .collect();
    let trimmed = clean.trim().replace(' ', "-");
    if trimmed.is_empty() { "export".to_string() } else { trimmed }
}

fn unique_export_path(folder: &Path, base: &str, ext: &str) -> PathBuf {
    let mut index = 1;
    loop {
        let name = if index == 1 {
            format!("{base}.{ext}")
        } else {
            format!("{base}-{index}.{ext}")
        };
        let candidate = folder.join(name);
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

// ---------------------------------------------------------------------------
// Base64

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_decode(input: &str) -> Option<Vec<u8>> {
    // Allow a data URI prefix.
    let input = match input.find(",") {
        Some(idx) if input[..idx].ends_with("base64") => &input[idx + 1..],
        _ => input,
    };
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for ch in input.bytes() {
        let value = match ch {
            b'A'..=b'Z' => (ch - b'A') as u32,
            b'a'..=b'z' => (ch - b'a' + 26) as u32,
            b'0'..=b'9' => (ch - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\r' | b'\n' | b' ' | b'\t' => {
                if ch == b'=' {
                    break;
                }
                continue;
            }
            _ => return None,
        };
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

// ---------------------------------------------------------------------------
// Checksums & zlib (store-only deflate)

pub fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, entry) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 };
        }
        *entry = c;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc = table[((crc ^ byte as u32) & 0xff) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

fn adler32(data: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

/// zlib (RFC 1950) wrapper around store-only deflate blocks.
pub fn zlib_store(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0x78, 0x01];
    let mut offset = 0usize;
    loop {
        let chunk_size = 65535usize.min(data.len() - offset);
        let last = offset + chunk_size >= data.len();
        out.push(if last { 0x01 } else { 0x00 });
        let len = chunk_size as u16;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&(!len).to_le_bytes());
        out.extend_from_slice(&data[offset..offset + chunk_size]);
        offset += chunk_size;
        if last {
            break;
        }
    }
    out.extend_from_slice(&adler32(data).to_be_bytes());
    out
}

// ---------------------------------------------------------------------------
// DEFLATE decoder (RFC 1951)

struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
    bit: u32,
}

impl<'a> BitReader<'a> {
    fn bits(&mut self, count: u32) -> Option<u32> {
        let mut value = 0u32;
        for i in 0..count {
            let byte = self.data.get(self.pos).copied()?;
            let b = (byte >> self.bit) & 1;
            value |= (b as u32) << i;
            self.bit += 1;
            if self.bit == 8 {
                self.bit = 0;
                self.pos += 1;
            }
        }
        Some(value)
    }
    fn align(&mut self) {
        if self.bit != 0 {
            self.bit = 0;
            self.pos += 1;
        }
    }
}

struct Huffman {
    counts: [u16; 16],
    symbols: Vec<u16>,
}

impl Huffman {
    fn new(lengths: &[u8]) -> Huffman {
        let mut counts = [0u16; 16];
        for &l in lengths {
            counts[l as usize] += 1;
        }
        counts[0] = 0;
        let mut offs = [0u16; 16];
        for i in 1..16 {
            offs[i] = offs[i - 1] + counts[i - 1];
        }
        let mut symbols = vec![0u16; lengths.len()];
        for (sym, &l) in lengths.iter().enumerate() {
            if l != 0 {
                symbols[offs[l as usize] as usize] = sym as u16;
                offs[l as usize] += 1;
            }
        }
        Huffman { counts, symbols }
    }

    fn decode(&self, reader: &mut BitReader) -> Option<u16> {
        let mut code: i32 = 0;
        let mut first: i32 = 0;
        let mut index: i32 = 0;
        for len in 1..16 {
            code |= reader.bits(1)? as i32;
            let count = self.counts[len] as i32;
            if code - first < count {
                return self.symbols.get((index + (code - first)) as usize).copied();
            }
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        None
    }
}

const LENGTH_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
const LENGTH_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

const LENGTH_CODE_EXTRA: [u8; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

fn fixed_tables() -> (Huffman, Huffman) {
    let mut lengths = [0u8; 288];
    for (i, l) in lengths.iter_mut().enumerate() {
        *l = match i {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    let dist_lengths = [5u8; 30];
    (Huffman::new(&lengths), Huffman::new(&dist_lengths))
}

fn dynamic_tables(reader: &mut BitReader) -> Option<(Huffman, Huffman)> {
    let hlit = reader.bits(5)? as usize + 257;
    let hdist = reader.bits(5)? as usize + 1;
    let hclen = reader.bits(4)? as usize + 4;
    let mut code_lengths = [0u8; 19];
    for &order in LENGTH_CODE_EXTRA.iter().take(hclen) {
        code_lengths[order as usize] = reader.bits(3)? as u8;
    }
    let code_table = Huffman::new(&code_lengths);
    let mut lengths = vec![0u8; hlit + hdist];
    let mut i = 0;
    while i < lengths.len() {
        let symbol = code_table.decode(reader)?;
        match symbol {
            0..=15 => {
                lengths[i] = symbol as u8;
                i += 1;
            }
            16 => {
                if i == 0 {
                    return None;
                }
                let previous = lengths[i - 1];
                let repeat = 3 + reader.bits(2)? as usize;
                for _ in 0..repeat {
                    if i >= lengths.len() {
                        return None;
                    }
                    lengths[i] = previous;
                    i += 1;
                }
            }
            17 => {
                let repeat = 3 + reader.bits(3)? as usize;
                i += repeat;
            }
            18 => {
                let repeat = 11 + reader.bits(7)? as usize;
                i += repeat;
            }
            _ => return None,
        }
    }
    if i > lengths.len() {
        return None;
    }
    Some((Huffman::new(&lengths[..hlit]), Huffman::new(&lengths[hlit..])))
}

/// Inflate a zlib (RFC 1950) stream containing DEFLATE data (RFC 1951).
pub fn inflate(data: Vec<u8>) -> Option<Vec<u8>> {
    // Skip the zlib header: CMF/FLG, plus 4 bytes when a preset dict is set.
    if data.len() < 3 || data[0] & 0x0F != 8 {
        return None;
    }
    if ((data[0] as u16) << 8 | data[1] as u16) % 31 != 0 {
        return None;
    }
    let start = if data[1] & 0x20 != 0 { 6 } else { 2 };
    let mut reader = BitReader { data: &data, pos: start, bit: 0 };
    let mut out: Vec<u8> = Vec::new();
    loop {
        let last = reader.bits(1)?;
        let kind = reader.bits(2)?;
        match kind {
            0 => {
                reader.align();
                let len = reader.bits(16)? as usize;
                let nlen = reader.bits(16)? as usize;
                if len ^ 0xFFFF != nlen {
                    return None;
                }
                for _ in 0..len {
                    out.push(reader.bits(8)? as u8);
                }
            }
            1 | 2 => {
                let (lit_table, dist_table) = if kind == 1 {
                    fixed_tables()
                } else {
                    dynamic_tables(&mut reader)?
                };
                loop {
                    let symbol = lit_table.decode(&mut reader)?;
                    match symbol {
                        0..=255 => out.push(symbol as u8),
                        256 => break,
                        257..=285 => {
                            let index = (symbol - 257) as usize;
                            let length = LENGTH_BASE[index] as usize
                                + reader.bits(LENGTH_EXTRA[index] as u32)? as usize;
                            let dist_symbol = dist_table.decode(&mut reader)? as usize;
                            if dist_symbol >= 30 {
                                return None;
                            }
                            let distance = DIST_BASE[dist_symbol] as usize
                                + reader.bits(DIST_EXTRA[dist_symbol] as u32)? as usize;
                            if distance > out.len() {
                                return None;
                            }
                            let start = out.len() - distance;
                            for k in 0..length {
                                let byte = out[start + k];
                                out.push(byte);
                            }
                        }
                        _ => return None,
                    }
                }
            }
            _ => return None,
        }
        if last == 1 {
            break;
        }
    }
    Some(out)
}

// ---------------------------------------------------------------------------
// PNG decode to raw RGB

/// Decode a PNG into raw RGB pixels (8-bit gray/RGB/RGBA/palette).
pub fn png_to_rgb(raw: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    if raw.len() < 8 || &raw[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let mut pos = 8usize;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut bit_depth = 8u8;
    let mut color: u8 = 6;
    let mut palette: Vec<u8> = Vec::new();
    let mut idat: Vec<u8> = Vec::new();
    while pos + 8 <= raw.len() {
        let length = u32::from_be_bytes([raw[pos], raw[pos + 1], raw[pos + 2], raw[pos + 3]]) as usize;
        let ctype = &raw[pos + 4..pos + 8];
        let data_start = pos + 8;
        let data_end = (data_start + length).min(raw.len());
        let data = &raw[data_start..data_end];
        match ctype {
            b"IHDR" if data.len() >= 13 => {
                width = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                height = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                bit_depth = data[8];
                color = data[9];
            }
            b"PLTE" => palette = data.to_vec(),
            b"IDAT" => idat.extend_from_slice(data),
            b"IEND" => break,
            _ => {}
        }
        pos = data_end + 4; // skip CRC
    }
    if width == 0 || height == 0 || bit_depth != 8 || idat.is_empty() {
        return None;
    }
    let channels: usize = match color {
        0 | 3 => 1,
        2 => 3,
        4 => 2,
        6 => 4,
        _ => return None,
    };
    let inflated = inflate(idat)?;
    let stride = width as usize * channels;
    let mut prev: Vec<u8> = vec![0u8; stride];
    let mut rgb: Vec<u8> = Vec::with_capacity(height as usize * width as usize * 3);
    let mut src = 0usize;
    for _row in 0..height as usize {
        if src + 1 + stride > inflated.len() {
            return None;
        }
        let filter = inflated[src];
        src += 1;
        let mut line = inflated[src..src + stride].to_vec();
        src += stride;
        // Unfilter in place; Paeth arithmetic is done in i32 (can go negative).
        for x in 0..line.len() {
            let left = if x >= channels { line[x - channels] as i32 } else { 0 };
            let up = prev[x] as i32;
            let up_left = if x >= channels { prev[x - channels] as i32 } else { 0 };
            let raw_byte = line[x] as i32;
            let value: i32 = match filter {
                0 => raw_byte,
                1 => raw_byte + left,
                2 => raw_byte + up,
                3 => raw_byte + (left + up) / 2,
                4 => {
                    let p = left + up - up_left;
                    let pa = p.abs_diff(left);
                    let pb = p.abs_diff(up);
                    let pc = p.abs_diff(up_left);
                    if pa <= pb && pa <= pc {
                        raw_byte + left
                    } else if pb <= pc {
                        raw_byte + up
                    } else {
                        raw_byte + up_left
                    }
                }
                _ => raw_byte,
            };
            line[x] = (value & 0xff) as u8;
        }
        match color {
            0 => {
                for &g in &line {
                    rgb.extend_from_slice(&[g, g, g]);
                }
            }
            2 => rgb.extend_from_slice(&line),
            3 => {
                for &index in &line {
                    let i = index as usize * 3;
                    if i + 2 < palette.len() {
                        rgb.push(palette[i]);
                        rgb.push(palette[i + 1]);
                        rgb.push(palette[i + 2]);
                    } else {
                        rgb.extend_from_slice(&[0, 0, 0]);
                    }
                }
            }
            4 => {
                for px in line.chunks(2) {
                    rgb.extend_from_slice(&[px[0], px[0], px[0]]);
                }
            }
            6 => {
                for px in line.chunks(4) {
                    rgb.extend_from_slice(&[px[0], px[1], px[2]]);
                }
            }
            _ => {}
        }
        prev = line;
    }
    Some((rgb, width, height))
}

// ---------------------------------------------------------------------------
// PDF: a valid PDF 1.4 with one page per image, XObject images embedded.

fn pdf_document(images: &[(Vec<u8>, u32, u32)]) -> Vec<u8> {
    // Object numbering: 1 = catalog, 2 = pages, then per page i (0-based):
    // page = 3+3i, image = 4+3i, content = 5+3i. Total objects = 2 + 3*count.
    let count = images.len();
    let total_objects = 2 + 3 * count;
    let header_bytes: &[u8] = b"%PDF-1.4\n%\xc7\xec\x8f\xa2\n";
    let header_len = header_bytes.len() as u32;
    let mut offsets = vec![0u32; total_objects + 1];
    let mut body = Vec::new();
    let mut pos = 0u32;
    fn push(body: &mut Vec<u8>, offsets: &mut [u32], pos: &mut u32, num: usize, content: &[u8], header_len: u32) {
        offsets[num] = header_len + *pos;
        let header = format!("{num} 0 obj\n");
        body.extend_from_slice(header.as_bytes());
        body.extend_from_slice(content);
        body.extend_from_slice(b"endobj\n");
        *pos += (header.len() + content.len() + 7) as u32;
    }

    let catalog = b"<< /Type /Catalog /Pages 2 0 R >>".to_vec();
    push(&mut body, &mut offsets, &mut pos, 1, &catalog, header_len);

    let mut pages_kids = String::new();
    for i in 0..count {
        pages_kids.push_str(&format!("{} 0 R ", 3 + 3 * i));
    }
    let pages_obj = format!("<< /Type /Pages /Count {count} /Kids [{pages_kids}] >>").into_bytes();
    push(&mut body, &mut offsets, &mut pos, 2, &pages_obj, header_len);

    for (i, (bytes, width, height)) in images.iter().enumerate() {
        let page_num = 3 + 3 * i;
        let image_num = 4 + 3 * i;
        let content_num = 5 + 3 * i;
        // Decode and recompress as Flate RGB.
        let (pixels, pw, ph) = match png_to_rgb(bytes) {
            Some(result) => result,
            None => (Vec::new(), *width, *height),
        };
        let (img_stream, pw, ph) = if pixels.is_empty() {
            (Vec::new(), *width, *height)
        } else {
            // Raw RGB rows, no PNG predictors (PDF FlateDecode without
            // /DecodeParms expects plain pixel data).
            (zlib_store(&pixels), pw, ph)
        };
        let image_obj = format!(
            "<< /Type /XObject /Subtype /Image /Width {pw} /Height {ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>\nstream\n",
            img_stream.len()
        )
        .into_bytes();
        let mut image_content = image_obj;
        image_content.extend_from_slice(&img_stream);
        image_content.extend_from_slice(b"\nendstream");
        push(&mut body, &mut offsets, &mut pos, image_num, &image_content, header_len);

        // Page in points: fit within 612x792 letter, centered.
        let (pw_f, ph_f) = (pw as f64, ph as f64);
        let max_w = 612.0f64;
        let max_h = 792.0f64;
        let scale = (max_w / pw_f).min(max_h / ph_f);
        let dw = pw_f * scale;
        let dh = ph_f * scale;
        let x = (max_w - dw) / 2.0;
        let y = (max_h - dh) / 2.0;
        let page_full = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 {image_num} 0 R >> >> /Contents {content_num} 0 R >>"
        )
        .into_bytes();
        push(&mut body, &mut offsets, &mut pos, page_num, &page_full, header_len);
        let content = format!("q {dw:.2} 0 0 {dh:.2} {x:.2} {y:.2} cm /Im0 Do Q");
        let content_obj =
            format!("<< /Length {} >>\nstream\n{}\nendstream", content.len(), content).into_bytes();
        push(&mut body, &mut offsets, &mut pos, content_num, &content_obj, header_len);
    }

    // Assemble with a complete xref table (one entry per object + the free entry).
    let mut out: Vec<u8> = header_bytes.to_vec();
    out.extend_from_slice(&body);
    let xref_pos = header_len + pos;
    let xref_size = total_objects + 1;
    out.extend_from_slice(format!("xref\n0 {xref_size}\n").as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for num in 1..=total_objects {
        out.extend_from_slice(format!("{:010} 00000 n \n", offsets[num]).as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {xref_size} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
        )
        .as_bytes(),
    );
    out
}

// ---------------------------------------------------------------------------
// PPTX: minimal OOXML package, one slide per image, image stretched to full.

struct ZipWriter {
    data: Vec<u8>,
    entries: Vec<(String, u32, u32, u32)>, // name, crc, offset, size
}

impl ZipWriter {
    fn new() -> ZipWriter {
        ZipWriter { data: Vec::new(), entries: Vec::new() }
    }
    fn add(&mut self, name: &str, content: &[u8]) {
        let crc = crc32(content);
        let offset = self.data.len() as u32;
        let mut header = vec![0u8; 30];
        header[0..4].copy_from_slice(&0x04034b50u32.to_le_bytes());
        header[4..6].copy_from_slice(&20u16.to_le_bytes());
        header[6..8].copy_from_slice(&0u16.to_le_bytes());
        header[8..10].copy_from_slice(&0u16.to_le_bytes()); // store
        header[10..12].copy_from_slice(&0u16.to_le_bytes());
        header[12..14].copy_from_slice(&0u16.to_le_bytes());
        header[14..18].copy_from_slice(&crc.to_le_bytes());
        let size = content.len() as u32;
        header[18..22].copy_from_slice(&size.to_le_bytes());
        header[22..26].copy_from_slice(&size.to_le_bytes());
        header[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
        header[28..30].copy_from_slice(&0u16.to_le_bytes());
        self.data.extend_from_slice(&header);
        self.data.extend_from_slice(name.as_bytes());
        self.data.extend_from_slice(content);
        self.entries.push((name.to_string(), crc, offset, size));
    }
    fn finish(mut self) -> Vec<u8> {
        let cd_offset = self.data.len() as u32;
        for (name, crc, offset, size) in &self.entries {
            let mut header = vec![0u8; 46];
            header[0..4].copy_from_slice(&0x02014b50u32.to_le_bytes());
            header[4..6].copy_from_slice(&20u16.to_le_bytes());
            header[6..8].copy_from_slice(&20u16.to_le_bytes());
            header[8..10].copy_from_slice(&0u16.to_le_bytes());
            header[10..12].copy_from_slice(&0u16.to_le_bytes());
            header[12..14].copy_from_slice(&0u16.to_le_bytes());
            header[14..16].copy_from_slice(&0u16.to_le_bytes()); // mod date
            header[16..20].copy_from_slice(&crc.to_le_bytes());
            header[20..24].copy_from_slice(&size.to_le_bytes());
            header[24..28].copy_from_slice(&size.to_le_bytes());
            header[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
            header[42..46].copy_from_slice(&offset.to_le_bytes());
            self.data.extend_from_slice(&header);
            self.data.extend_from_slice(name.as_bytes());
        }
        let cd_size = self.data.len() as u32 - cd_offset;
        let count = self.entries.len() as u16;
        let mut end = vec![0u8; 22];
        end[0..4].copy_from_slice(&0x06054b50u32.to_le_bytes());
        end[8..10].copy_from_slice(&count.to_le_bytes());
        end[10..12].copy_from_slice(&count.to_le_bytes());
        end[12..16].copy_from_slice(&cd_size.to_le_bytes());
        end[16..20].copy_from_slice(&cd_offset.to_le_bytes());
        self.data.extend_from_slice(&end);
        self.data
    }
}

fn pptx_document(images: &[(Vec<u8>, u32, u32)]) -> Result<Vec<u8>, String> {
    let mut zip = ZipWriter::new();
    let mut content_types = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"png\" ContentType=\"image/png\"/><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/><Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/><Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/><Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>",
    );
    for index in 0..images.len() {
        content_types.push_str(&format!(
            "<Override PartName=\"/ppt/slides/slide{}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>",
            index + 1
        ));
    }
    content_types.push_str("</Types>");
    zip.add("[Content_Types].xml", content_types.as_bytes());
    let mut rels = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    );
    rels.push_str("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/>");
    rels.push_str("</Relationships>");
    zip.add("_rels/.rels", rels.as_bytes());

    // presentation.xml with one slide per image
    let mut slide_ids = String::new();
    for i in 0..images.len() {
        slide_ids.push_str(&format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 256 + i, 2 + i));
    }
    let mut pres_rels = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    );
    pres_rels.push_str("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>");
    for i in 0..images.len() {
        pres_rels.push_str(&format!(
            "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{}.xml\"/>",
            2 + i,
            i + 1
        ));
    }
    pres_rels.push_str("<Relationship Id=\"rId99\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"theme/theme1.xml\"/>");
    pres_rels.push_str("</Relationships>");
    zip.add("ppt/_rels/presentation.xml.rels", pres_rels.as_bytes());
    zip.add(
        "ppt/presentation.xml",
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst><p:sldIdLst>{slide_ids}</p:sldIdLst><p:sldSz cx=\"12192000\" cy=\"6858000\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/></p:presentation>"
        )
        .as_bytes(),
    );

    // slide master (references the layout) + layout (minimal)
    zip.add(
        "ppt/slideMasters/slideMaster1.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>"#,
    );
    zip.add(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>"#,
    );
    zip.add(
        "ppt/slideLayouts/slideLayout1.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">
<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"#,
    );
    zip.add(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>"#,
    );
    zip.add(
        "ppt/theme/theme1.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Dupo"><a:themeElements><a:clrScheme name="Dupo"><a:dk1><a:srgbClr val="1F2430"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="3A3F4B"/></a:dk2><a:lt2><a:srgbClr val="E8EAF0"/></a:lt2><a:accent1><a:srgbClr val="3A86FF"/></a:accent1><a:accent2><a:srgbClr val="34A86A"/></a:accent2><a:accent3><a:srgbClr val="E5484D"/></a:accent3><a:accent4><a:srgbClr val="F5A524"/></a:accent4><a:accent5><a:srgbClr val="7C5CFF"/></a:accent5><a:accent6><a:srgbClr val="1FB6C4"/></a:accent6><a:hlink><a:srgbClr val="3A86FF"/></a:hlink><a:folHlink><a:srgbClr val="7C5CFF"/></a:folHlink></a:clrScheme><a:fontScheme name="Dupo"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="94000"/><a:satMod val="340000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="94000"/><a:satMod val="340000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="50800" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="60000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="94000"/><a:satMod val="340000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:shade val="94000"/><a:satMod val="340000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="78000"/><a:satMod val="340000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>"#,
    );

    // Slides
    for (index, (bytes, width, height)) in images.iter().enumerate() {
        let slide_num = index + 1;
        let image_name = format!("image{slide_num}.png");
        zip.add(&format!("ppt/media/{image_name}"), bytes);
        let slide_rels = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/{image_name}\"/></Relationships>"
        );
        zip.add(&format!("ppt/slides/_rels/slide{slide_num}.xml.rels"), slide_rels.as_bytes());
        let slide_xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id=\"2\" name=\"Page {slide_num}\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed=\"rId2\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"12192000\" cy=\"6858000\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
        );
        zip.add(&format!("ppt/slides/slide{slide_num}.xml"), slide_xml.as_bytes());
        let _ = (width, height);
    }

    Ok(zip.finish())
}

fn png_zip(images: &[(Vec<u8>, u32, u32)]) -> Vec<u8> {
    let mut zip = ZipWriter::new();
    for (index, (bytes, _, _)) in images.iter().enumerate() {
        zip.add(&format!("page-{}.png", index + 1), bytes);
    }
    zip.finish()
}

fn open_path(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd").args(["/C", "start"]).arg(path).spawn();
    }
}

pub fn export_to_path(
    format: &str,
    pages: &[String],
    destination: &Path,
) -> Result<(), String> {
    let images = decode_pngs(pages)?;
    let bytes = match format {
        "pdf" => pdf_document(&images),
        "pptx" => pptx_document(&images)?,
        // Single-page PNG writes the real PNG bytes at the given destination.
        "png" if images.len() == 1 => images[0].0.clone(),
        "png" => png_zip(&images),
        other => return Err(format!("Unknown export format: {other}")),
    };
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = fs::File::create(destination).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    open_path(destination);
    Ok(())
}

pub fn export_to(folder: &Path, base: &str, format: &str, pages: &[String]) -> Result<String, String> {
    let images = decode_pngs(pages)?;
    let base = slug(base);
    // Single-page PNG export writes a real PNG file; multi-page writes a zip.
    if format == "png" && images.len() == 1 {
        let destination = unique_export_path(folder, &base, "png");
        let mut file = fs::File::create(&destination).map_err(|e| e.to_string())?;
        file.write_all(&images[0].0).map_err(|e| e.to_string())?;
        open_path(&destination);
        return Ok(destination.to_string_lossy().into_owned());
    }
    let ext = match format {
        "pdf" => "pdf",
        "pptx" => "pptx",
        "png" => "zip",
        other => return Err(format!("Unknown export format: {other}")),
    };
    let destination = unique_export_path(folder, &base, ext);
    let bytes = match format {
        "pdf" => pdf_document(&images),
        "pptx" => pptx_document(&images)?,
        "png" => png_zip(&images),
        _ => unreachable!(),
    };
    let mut file = fs::File::create(&destination).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    open_path(&destination);
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TINY_PNG: &str =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    #[test]
    fn export_formats_produce_valid_documents() {
        let pages = vec![TINY_PNG.to_string(), TINY_PNG.to_string()];
        let images = decode_pngs(&pages).expect("pages decode");
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].1, 1);
        assert_eq!(images[0].2, 1);

        let pdf = pdf_document(&images);
        assert!(pdf.starts_with(b"%PDF"), "pdf magic");

        let pptx = pptx_document(&images).expect("pptx builds");
        assert!(pptx.starts_with(b"PK"), "pptx zip magic");

        let zip = png_zip(&images);
        assert!(zip.starts_with(b"PK"), "png zip magic");
    }

    #[test]
    fn rejects_bad_pages() {
        assert!(decode_pngs(&[("not base64!!!".to_string())]).is_err());
        assert!(decode_pngs(&[]).is_err());
    }

    #[test]
    fn paeth_unfilter_does_not_panic() {
        // 2x2 RGB PNG whose second row uses Paeth filtering with
        // up_left > left + up (would underflow a u32 subtraction).
        fn chunk(ctype: &[u8; 4], data: &[u8]) -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(ctype);
            out.extend_from_slice(data);
            let mut crc_input = ctype.to_vec();
            crc_input.extend_from_slice(data);
            out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
            out
        }
        let mut raw = Vec::new();
        raw.push(0u8); // row 1: no filter — [255,255,255, 0,0,0]
        raw.extend_from_slice(&[255, 255, 255, 0, 0, 0]);
        raw.push(4u8); // row 2: Paeth
        raw.extend_from_slice(&[1, 0, 0, 0, 0, 0]);
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.push(8); // bit depth
        ihdr.push(2); // color type RGB
        ihdr.extend_from_slice(&[0, 0, 0]);
        png.extend_from_slice(&chunk(b"IHDR", &ihdr));
        png.extend_from_slice(&chunk(b"IDAT", &zlib_store(&raw)));
        png.extend_from_slice(&chunk(b"IEND", &[]));
        let (pixels, width, height) = png_to_rgb(&png).expect("paeth png decodes");
        assert_eq!((width, height), (2, 2));
        assert_eq!(pixels.len(), 12);
    }

    #[test]
    fn pdf_xref_offsets_point_at_objects() {
        let pages = vec![TINY_PNG.to_string(), TINY_PNG.to_string()];
        let images = decode_pngs(&pages).unwrap();
        let pdf = pdf_document(&images);
        // Locate "startxref" and parse the xref position.
        let marker = b"startxref";
        let marker_pos = pdf
            .windows(marker.len())
            .position(|w| w == marker)
            .expect("startxref present");
        let tail = &pdf[marker_pos + marker.len()..];
        let xref_pos: usize = tail
            .split(|&b| b == b' ' || b == b'\n' || b == b'\r')
            .find(|s| !s.is_empty())
            .unwrap()
            .iter()
            .map(|&b| b as char)
            .collect::<String>()
            .parse()
            .unwrap();
        // The xref position must point at the "xref" keyword.
        assert!(pdf[xref_pos..].starts_with(b"xref"), "xref at stated position");
        // Parse "xref\n0 N\n" then the 20-byte entries.
        let mut cursor = xref_pos + 4;
        while pdf[cursor] == b'\n' || pdf[cursor] == b'\r' {
            cursor += 1;
        }
        let line_end = pdf[cursor..]
            .iter()
            .position(|&b| b == b'\n')
            .expect("xref header line ends");
        let header_text = String::from_utf8_lossy(&pdf[cursor..cursor + line_end]);
        let size: usize = header_text
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        // size = total objects + 1 free entry; 2 images → 2 + 3*2 = 8 objects.
        assert_eq!(size, 2 + 3 * 2 + 1);
        let mut entry_cursor = cursor + line_end + 1 + 20; // skip free entry (20 bytes)
        for num in 1..size {
            let entry = &pdf[entry_cursor..entry_cursor + 20];
            let offset_str = String::from_utf8_lossy(&entry[..10]);
            let offset: usize = offset_str.trim().parse().unwrap();
            let expected = format!("{num} 0 obj");
            assert!(
                pdf[offset..].starts_with(expected.as_bytes()),
                "xref entry {num} offset wrong"
            );
            entry_cursor += 20;
        }
    }

    #[test]
    fn inflate_roundtrip_store() {
        let data = b"hello deflate world".repeat(100);
        let z = zlib_store(&data);
        assert_eq!(inflate(z).unwrap(), data);
    }
}
