// Original premise seeds, one picked at random per story. They are written in the spirit of common
// campfire / "creepypasta" tropes (a rule that changes, a sound that answers back); they are NOT taken from
// any specific story. Each is short on purpose: the model builds the story around it in the listener's place.
// No seed may involve sexual content, harm to children or self-harm (the profile limits still apply on top).

export const PREMISE_SEEDS: readonly string[] = [
  "A sound in the house answers the listener a half-second late, and each time it answers a little closer.",
  "Someone has been moving one small everyday object each night, always one step nearer to the listener's bed.",
  "In the next room, someone is going through the listener's evening routine a minute ahead of them.",
  "The neighbour's lights come on exactly when the listener's go off, as if the two windows are taking turns.",
  "The listener remembers an old house rule they were once told and never questioned: never answer the first knock.",
  "An old radio switches itself on between stations and starts reading the listener's next sentence a moment before they say it.",
  "Footsteps cross the room upstairs, step for step with the listener's own. But there is no upstairs.",
  "Every dark window shows the room slightly tidier than it really is, as though someone has been tidying it from the other side.",
  "Each time the power flickers and returns, one thing in the room has moved, and the pattern points somewhere.",
  "A familiar smell that does not belong here, rain on a doorstep or old coffee, grows stronger room by room, leading the way.",
  "A door that the listener closed keeps being found ajar, then closed again, then ajar, as if from the inside.",
  "A message arrives from the listener's own number, describing exactly what they are doing right now.",
  "The house settles at night with the usual creaks, but tonight the creaks form a rhythm that is almost a word.",
  "A guest the listener does not remember inviting is mentioned casually in every room, as if they have always lived there.",
];

/** Pick a seed. `rng` is injectable so tests (and replays) can be deterministic. */
export function pickPremise(rng: () => number = Math.random): string {
  return PREMISE_SEEDS[Math.min(PREMISE_SEEDS.length - 1, Math.floor(rng() * PREMISE_SEEDS.length))];
}
