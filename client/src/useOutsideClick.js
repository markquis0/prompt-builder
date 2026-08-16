import { useEffect } from "react";

// Shared by NavHeader.jsx's three independent dropdowns (More menu, profile
// menu, mobile nav panel) — each needs identical "click anywhere else
// closes this" behavior. Previously written inline once, for the single
// mobile-account dropdown that existed before the header redesign.
export function useOutsideClick(ref, isOpen, onOutsideClick) {
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        onOutsideClick();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ref, isOpen, onOutsideClick]);
}
