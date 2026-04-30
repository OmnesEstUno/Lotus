import lotusUrl from './lotus.svg';

interface LogoProps {
  /** Height of the rendered logo in pixels. Width is derived from the SVG's aspect ratio. */
  size?: number;
  /** Any CSS color. Defaults to `currentColor` so it inherits from parent text. */
  color?: string;
  style?: React.CSSProperties;
}

/**
 * Lotus app logo.
 *
 * Implemented as a CSS mask: the traced SVG acts as an alpha mask and the
 * background-color provides the fill, so the logo picks up `currentColor`
 * from its parent (or any color you pass via the `color` prop).
 *
 * Source SVG is 180×120 → width is 1.5× the height.
 */
export default function Logo({ size = 20, color = 'currentColor', style }: LogoProps) {
  const width = Math.round(size * 1.5); // 180/120 aspect ratio
  return (
    <span
      role="img"
      aria-label="Lotus logo"
      style={{
        display: 'inline-block',
        width,
        height: size,
        backgroundColor: color,
        WebkitMaskImage: `url(${lotusUrl})`,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskImage: `url(${lotusUrl})`,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
        ...style,
      }}
    />
  );
}
