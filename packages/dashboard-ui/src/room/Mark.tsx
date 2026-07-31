/**
 * The ABSuite mark.
 *
 * An isometric cube whose front faces carry the letterforms in negative space —
 * the identity and the primary primitive are the same object, which is the whole
 * argument of this interface stated in a logo.
 *
 * This is a reconstruction from the supplied renders, not the supplied file.
 * The originals arrived as images rather than assets, so the geometry here is
 * traced rather than authoritative: the proportions and the negative-space cuts
 * are matched by eye. Replace it with the real SVG when that exists — the
 * component takes a `size` and nothing else, so swapping the paths changes
 * nothing around it.
 */

export const Mark = ({ size = 34, title = 'ABSuite' }: { size?: number; title?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 120 132"
    fill="none"
    role="img"
    aria-label={title}
    style={{ display: 'block' }}
  >
    <defs>
      <linearGradient id="absuite-mark" x1="18" y1="6" x2="102" y2="126" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6BF5A8" />
        <stop offset="0.45" stopColor="#00F58C" />
        <stop offset="1" stopColor="#0A9E52" />
      </linearGradient>
    </defs>

    {/* The cube. A hexagonal silhouette with the three visible faces implied by
        the internal spokes, drawn as an outline so the mark reads at any size. */}
    <path
      d="M60 4 111 33.5V98.5L60 128 9 98.5V33.5Z"
      stroke="url(#absuite-mark)"
      strokeWidth="7"
      strokeLinejoin="round"
    />

    {/* Top face. */}
    <path
      d="M60 20 96 41 60 62 24 41Z"
      stroke="url(#absuite-mark)"
      strokeWidth="5"
      strokeLinejoin="round"
      opacity="0.85"
    />

    {/* The vertical spoke: the near edge where the two lower faces meet. */}
    <path d="M60 62V128" stroke="url(#absuite-mark)" strokeWidth="6" />

    {/* Left face — the A, cut as negative space. */}
    <path
      d="M31 55V96l12 7V78h9v25l8 5V62"
      stroke="url(#absuite-mark)"
      strokeWidth="6"
      strokeLinejoin="round"
      strokeLinecap="round"
      fill="none"
    />

    {/* Right face — the B. */}
    <path
      d="M89 55v41l-12 7V88h-9v10l-8 5"
      stroke="url(#absuite-mark)"
      strokeWidth="6"
      strokeLinejoin="round"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M89 74h-12"
      stroke="url(#absuite-mark)"
      strokeWidth="6"
      strokeLinecap="round"
    />
  </svg>
);

export default Mark;
