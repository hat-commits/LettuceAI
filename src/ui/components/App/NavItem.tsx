import { motion } from "framer-motion";
import { Link } from "react-router-dom";

export function TabItem({
  to,
  icon: Icon,
  label,
  active,
  className = "",
  dataTourId,
}: {
  to: string;
  icon: any;
  label: string;
  active: boolean;
  className?: string;
  dataTourId?: string;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-tour-id={dataTourId}
      className={`relative block ${className}`}
    >
      <motion.div
        className={`relative flex h-full w-full items-center justify-center rounded-full font-medium transition ${
          active ? "text-fg" : "text-fg/38 hover:text-fg/80"
        }`}
        whileTap={{ scale: 0.95 }}
      >
        {active && (
          <motion.div
            className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg/8 shadow-[0_0_24px_rgba(255,255,255,0.22)]"
            initial={{ opacity: 0, scale: 0.84 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          />
        )}
        <Icon size={22} strokeWidth={active ? 2.45 : 2.2} className="relative z-10" />
        <span className="sr-only">{label}</span>
      </motion.div>
    </Link>
  );
}
