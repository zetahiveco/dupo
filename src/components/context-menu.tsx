import { useEffect, useRef, type ReactNode } from "react";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type MenuState = {
  screenX: number;
  screenY: number;
  items: MenuItem[];
} | null;

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const width = 200;
  const left = Math.min(menu.screenX, window.innerWidth - width - 12);
  const top = Math.min(menu.screenY, window.innerHeight - menu.items.length * 30 - 24);

  return (
    <div className="context-menu" ref={ref} style={{ left: Math.max(8, left), top: Math.max(8, top), width }}>
      {menu.items.map((item, index) => (
        <button
          key={index}
          className={"context-item" + (item.danger ? " danger" : "")}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon ? <span className="context-icon">{item.icon}</span> : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}
