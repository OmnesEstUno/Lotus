interface LogoProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

export default function Logo({ size = 20, color = 'currentColor', style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-label="Finastic lotus logo"
    >
      {/* Outer left petal */}
      <path d="M12 18 C7 17 4 13 3 8 C6 12 9 15 12 18 Z" opacity="0.55" />
      {/* Outer right petal */}
      <path d="M12 18 C17 17 20 13 21 8 C18 12 15 15 12 18 Z" opacity="0.55" />
      {/* Inner left petal */}
      <path d="M12 18 C9 15 7 10 7 4 C9 9 11 14 12 18 Z" opacity="0.78" />
      {/* Inner right petal */}
      <path d="M12 18 C15 15 17 10 17 4 C15 9 13 14 12 18 Z" opacity="0.78" />
      {/* Center petal */}
      <path d="M12 18 C14 14 14 7 12 3 C10 7 10 14 12 18 Z" />
      {/* Base calyx */}
      <path d="M3 18 Q12 22 21 18 Q12 20 3 18 Z" />
    </svg>
  );
}
