const crew = [
  { name: 'Planner', image: '/assets/crew-planner.webp' },
  { name: 'Coder', image: '/assets/crew-coder.webp' },
  { name: 'Tester', image: '/assets/crew-tester.webp' },
  { name: 'Reviewer', image: '/assets/crew-reviewer.webp' },
  { name: 'Docs', image: '/assets/crew-docs.webp' },
  { name: 'Researcher', image: '/assets/crew-researcher.webp' },
];

export function CrewSection() {
  return (
    <section className="crew-section" id="crew" aria-labelledby="crew-title">
      <img
        className="crew-scene"
        src="/assets/crew-scene.webp"
        alt="Six colorful ghost agents floating together in their moonlit haunted office."
        width={3344}
        height={1882}
        loading="lazy"
      />
      <div className="crew-copy">
        <p className="crew-eyebrow">Your haunted office team</p>
        <h2 className="crew-title" id="crew-title">Meet the crew</h2>
        <p className="crew-intro">Six specialist agents. One haunted office.</p>
      </div>
      <ul className="crew-roster" aria-label="The six ghost agents">
        {crew.map(({ name, image }) => (
          <li key={name}>
            <img className="crew-ghost" src={image} alt="" />
            <span>{name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
