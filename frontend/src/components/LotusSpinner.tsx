/**
 * LotusSpinner — full-viewport loading splash. Theme-aware translucent
 * backdrop (70% opacity + 5px blur over var(--bg-base)) with the bloomed
 * lotus rotating CW in the center. Use anywhere a request, navigation, or
 * other operation can exceed ~1s.
 *
 * The SVG is inlined (not fetched as an <img>) so the lotus appears in the
 * very first render — no async asset round-trip that could miss the window
 * for synchronous operations.
 *
 * The CSS rotation is suppressed automatically when the user has set
 * data-reduce-motion="on" (handled globally in index.css).
 */

// Canonical major + minor petal d-strings (lotus-bloomed-reference.svg path13 / path16).
const MAJOR_D =
  'm 124.76,112.27 c -0.27,-0.03 -1.13,-0.13 -1.88,-0.2 -4.38,-0.48 -9.27,-2.08 -13.2,-4.3 -2.71,-1.54 -6.79,-4.5 -7.79,-5.65 -0.33,-0.39 -0.29,-0.36 1.3,0.65 5.81,3.72 10.63,5.67 16.15,6.5 2.15,0.33 7.64,0.38 9.74,0.09 6.19,-0.87 11.67,-3.12 16.56,-6.79 1.62,-1.23 2.7,-2.12 11.44,-9.46 2.18,-1.83 4.49,-3.75 5.13,-4.25 0.65,-0.52 1.18,-1.02 1.18,-1.11 0.01,-0.1 -0.59,-0.58 -1.31,-1.08 -1.38,-0.92 -6,-4.13 -10.57,-7.33 -7.59,-5.31 -10.11,-6.74 -14.42,-8.16 -3.75,-1.23 -7.38,-1.72 -11.87,-1.6 -4.62,0.12 -7.4,0.68 -11.5,2.29 -3.33,1.31 -5.99,2.94 -11.24,6.88 -3.91,2.96 -8.18,6.1 -9.53,7.04 -1.62,1.13 7.67,-7.67 11.73,-11.11 3.75,-3.17 7.56,-5.38 11.96,-6.89 7.04,-2.44 16.08,-2.42 23.45,0.04 3.35,1.11 6.4,2.68 10.2,5.21 3.56,2.38 20.42,14.18 20.55,14.38 0.04,0.07 -3.12,2.71 -7.01,5.87 -3.89,3.16 -8.03,6.5 -9.2,7.46 -2.77,2.24 -6.36,4.95 -7.92,5.96 -1.66,1.08 -4.64,2.6 -6.52,3.32 -3.91,1.5 -7.5,2.18 -12.04,2.26 -1.59,0.04 -3.12,0.03 -3.39,0 z';
const MINOR_D =
  'm 126.13,100.86 c -3.26,-0.2 -6.42,-1.08 -9.29,-2.58 -1.33,-0.68 -3,-1.73 -2.57,-1.59 4.92,1.57 7.86,2.08 11.15,1.9 5,-0.26 9.3,-1.82 13.23,-4.8 1.85,-1.38 5.87,-4.99 5.87,-5.24 0,-0.14 -4.4,-3.32 -5.91,-4.25 -3.58,-2.21 -6.65,-3.06 -10.46,-2.91 -7.25,0.27 -13.07,3.09 -28.2,13.67 -1.47,1.02 -2.68,1.86 -2.71,1.86 -0.32,0 4.82,-5.12 8.35,-8.37 6.55,-5.99 12.65,-9.48 18.87,-10.77 1.59,-0.33 2.16,-0.39 4.63,-0.39 2.13,-0.01 3.14,0.04 4.18,0.25 3.22,0.61 6.76,2.16 10.17,4.46 2.18,1.47 8.35,6 8.41,6.17 0.07,0.2 -7.5,6.2 -10.07,7.96 -3.27,2.25 -6.23,3.53 -9.74,4.21 -1.17,0.23 -4.18,0.53 -4.83,0.49 -0.2,-0.01 -0.68,-0.04 -1.08,-0.07 z';

// Per-pair rotation transforms, transcribed from lotus-bloomed-reference.svg.
const PAIR_TRANSFORMS = [
  'rotate(-121.0359 90.085214 97.122992)',
  'rotate(166.9641 86.228224 100.52285)',
  'rotate(94.9641 81.67293 104.53824)',
  'rotate(22.9641 58.936937 124.57955)',
  'rotate(-49.0359 99.319574 88.983088)',
];

export default function LotusSpinner() {
  return (
    <div className="lotus-spinner-overlay" role="status" aria-label="Loading">
      <svg
        className="lotus-spinner-svg"
        viewBox="0 0 163.34724 169.59622"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* `lotus-spinner-rotor` carries the CSS rotation animation — see
            index.css. We rotate this inner <g> rather than the outer <svg>
            because CSS transforms on inner SVG nodes (with transform-box:
            view-box) behave consistently across browsers, whereas CSS
            transforms on the root <svg> have known quirks. */}
        <g className="lotus-spinner-rotor">
          <g fill="var(--accent)" transform="rotate(-56.8 70.262532 97.186088)">
            {PAIR_TRANSFORMS.map((t, i) => (
              <g key={i} transform={t}>
                <path d={MAJOR_D} />
                <path d={MINOR_D} />
              </g>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
