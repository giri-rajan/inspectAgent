/** A casting seen from above (rim, hub, six vanes) on the lavender brand square. */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#5e6ad2" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.4" fill="#fff" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <path key={a} d="M16 13.2 Q19 10.5 18.6 7.4" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" transform={`rotate(${a} 16 16)`} />
      ))}
    </svg>
  );
}
