# Sunday Strategist: product spec

A football coaching and recognition game. The player reads a situation, diagnoses what the defense is showing, gathers information, sets protection, calls a play, picks a key defender and a contingency, then sees what the defense really did and why the play worked or didn't.

**The one rule:** the game teaches players how to think through a situation, not memorize "correct" calls.

## Principles (every feature serves one)

1. **Football knowledge is the gameplay.** Explanations are the tool you win with, not a lecture afterward.
2. **Process is graded apart from the result.** There are six grades per snap: Diagnosis, Call, Protection, Answer (contingency), Execution and Result. The first four are the decision; the last two are one roll of the dice.
3. **No single correct answer.** Calls are ranked (recommended, high floor, aggressive, conservative, poor fit) with tradeoffs and their odds over hundreds of reps.
4. **Pre-snap reads are probabilistic.** Diagnosis is graded on how well you read the evidence, not on whether the defense was honest. A disguised blitz you read as a blitz is still a good read.
5. **Motion is evidence, not proof.** Its reveal says so every time.
6. **"Who needed to hold up?"** Every play shows assignment cards: the job, the key defender, the win and fail condition, and whether it held up.
7. **Provenance.** Every scenario says where its facts came from. Synthetic scenarios are labeled as such and never attached to a real game. A real NFL call is evidence of what happened, not proof of what should have happened.
8. **Transfer.** Mastery means recognizing the same idea in a changed picture: a flipped field, a new formation, real pressure versus a bluff.

## Real NFL content

Real team names, games, situations and outcomes may be used where public data (nflverse play-by-play, participation, FTN charting) supports them, labeled with their source and confidence. The game uses no official logos, wordmarks, uniforms, broadcast footage or player photos. Names sit in the presentation layer, so a fictional-league mode needs no change to scenario logic. This isn't legal advice: get a review before any commercial use.

## Audience

Fans who watch every Sunday and want to see what the quarterback and the coordinator see. The language stays plain first; coaching terms come with a plain-English explanation.

## The first vertical slice (shipped)

The module is **Nickel pressure and the answers to it**, offense in 11 personnel against nickel.

- **The Nickel Comes** (3rd-and-6): a nickel fire zone with Cover 3 behind it. The field safety replaces the blitzer, and the lesson is to throw away from the replacement.
- **Same Look, Different Answer** (2nd-and-7): the same pre-snap tells, with the formation and field flipped, and the pressure is a bluff into Cover 2. The lesson is to pick a call that survives both.

What a player can do in the slice:

- Diagnose: personnel, shell, every possible rusher (tapped on the field), likely pressure, and their confidence.
- Use motion and see what it revealed.
- Set protection, call the play (routes draw on the field), name the key defender, and choose a contingency.
- Watch the post-snap reveal: rushers, drops, zones and rotation.
- Review the six grades, the play's odds over 400 reps, a re-run of the same call, the clues ranked meaningful, deceptive or uncertain, assignment cards, a causal timeline, ranked alternatives, the next-call implication, and a one-line takeaway.
- Keep a read report per skill, filed by error type, which picks the next scenario: unseen first, then the weakest skill that's due.

See ROADMAP.md for what comes next.
