// The "agent" part: reads the metrics and decides what is worth saying.
// Rule-based for now. Each rule looks at one signal, and only speaks when
// there is enough data for it to mean something. To swap in an LLM later,
// replace generateInsights() with a call that gets the same metrics object
// and returns the same { headline, insights, actions } shape.

const LIMITS = {
  slowFillSeconds: 120,
  fastFillSeconds: 60,
  pinFailRate: 0.15,
  mobileShare: 0.4,
  stuckRate: 0.25,
  lowCopies: 1,
  highCopies: 3,
  bigRoom: 80, // Firebase free plan allows 100 simultaneous connections
  minAttempts: 5,
};

const fmtPct = (x) => Math.round(x * 100) + "%";
const fmtSecs = (s) => (s < 90 ? `${s}s` : `${Math.round(s / 6) / 10} min`);

export function change(cur, prev) {
  if (prev == null || cur == null) return null;
  if (prev === 0) return cur === 0 ? 0 : null; // from nothing, a % change means nothing
  return (cur - prev) / prev;
}

export function generateInsights(m) {
  const c = m.current, p = m.previous;
  const insights = [];
  const actions = [];
  const say = (level, title, detail, action) => {
    insights.push({ level, title, detail });
    if (action && !actions.includes(action)) actions.push(action);
  };

  if (c.events === 0) {
    say("info", "Quiet week", "No rooms were opened and nobody joined in the last 7 days.",
      "Message two workshop organisers this week and offer to run Roomkey for them.");
    return { headline: "No activity this week.", insights, actions };
  }

  // Growth
  const g = change(c.attendees, p.attendees);
  if (p.attendees === 0 && c.attendees > 0) {
    say("good", "First laptops in", `${c.attendees} laptops joined a room this week, up from none the week before.`);
  } else if (g != null && Math.abs(g) >= 0.2) {
    say(g > 0 ? "good" : "watch", g > 0 ? "More people in rooms" : "Fewer people in rooms",
      `${c.attendees} laptops joined this week, ${g > 0 ? "up" : "down"} ${fmtPct(Math.abs(g))} on last week (${p.attendees}).`,
      g < 0 ? "Line up at least one hands-on event for next week so usage doesn't stall." : null);
  }

  // Real sessions vs testing
  if (c.realSessions > 0) {
    say("good", `${c.realSessions} real session${c.realSessions > 1 ? "s" : ""}`,
      `Rooms with ${3}+ laptops. Biggest room had ${c.largestRoom} laptops, typical room ${c.medianLaptops}.`);
  }
  if (c.roomsCreated >= 2 && c.testRooms / c.roomsCreated >= 0.5) {
    say("watch", "Most rooms were tests", `${c.testRooms} of ${c.roomsCreated} rooms opened this week never got past 2 laptops.`,
      "Find out whether presenters are just trying it out, or opening a room and then not using it in the session.");
  }

  // Joining speed: the core promise
  if (c.medianFillSeconds != null) {
    if (c.medianFillSeconds > LIMITS.slowFillSeconds) {
      say("watch", "Rooms are slow to fill", `It took ${fmtSecs(c.medianFillSeconds)} for a typical room to reach 80% of its laptops.`,
        "Make the URL and code the biggest thing on the projector screen, and get a short domain.");
    } else if (c.medianFillSeconds <= LIMITS.fastFillSeconds) {
      say("good", "Rooms fill fast", `A typical room reached 80% of its laptops in ${fmtSecs(c.medianFillSeconds)}.`);
    }
  }

  // PIN friction
  if (c.pinFails + c.attendees >= LIMITS.minAttempts && c.pinFailRate > LIMITS.pinFailRate) {
    say("watch", "People are mistyping the PIN", `${fmtPct(c.pinFailRate)} of join attempts had a wrong PIN (${c.pinFails} misses).`,
      "Make the PIN larger on the projector, or read it out loud at the start.");
  }

  // Phones vs laptops
  if (c.attendees >= LIMITS.minAttempts && c.mobileShare > LIMITS.mobileShare) {
    say("watch", "Lots of people joined on phones", `${fmtPct(c.mobileShare)} of attendees joined from a phone. Keys are needed on laptops.`,
      "Tell people to type the URL into their laptop browser instead of scanning the QR.");
  }

  // Is it being used once people are in?
  if (c.attendees >= LIMITS.minAttempts && c.copiesPerAttendee != null) {
    if (c.copiesPerAttendee < LIMITS.lowCopies) {
      say("watch", "People join but don't copy much", `${c.copiesPerAttendee.toFixed(1)} copies per attendee. They may not need what's pasted, or copy by hand.`,
        "Ask a presenter what they pasted and whether attendees used it.");
    } else if (c.copiesPerAttendee >= LIMITS.highCopies) {
      say("good", "Copy buttons are doing the work", `${c.copiesPerAttendee.toFixed(1)} copies per attendee, ${c.copies} in total.`);
    }
  }

  // Stuck signal
  if (c.attendees >= LIMITS.minAttempts && c.stuckPeople > 0) {
    say(c.stuckRate > LIMITS.stuckRate ? "watch" : "info", "\"I'm stuck\" is being used",
      `${c.stuckPeople} attendee${c.stuckPeople > 1 ? "s" : ""} (${fmtPct(c.stuckRate)}) pressed it this week.`,
      c.stuckRate > LIMITS.stuckRate ? "Ask presenters what people got stuck on. That's a feature idea waiting to happen." : null);
  }

  // Security habit
  if (c.roomsCreated >= 2 && c.closeRate != null && c.closeRate < 0.5) {
    say("info", "Rooms are left open", `Only ${fmtPct(c.closeRate)} of rooms were closed after the session, so notes stay up.`,
      "Consider auto-closing rooms a few hours after the last activity.");
  }

  // Scale ceiling
  if (c.largestRoom >= LIMITS.bigRoom) {
    say("watch", "Close to the free-plan limit", `One room had ${c.largestRoom} laptops. Firebase's free plan caps live connections at 100.`,
      "Move Firebase to the pay-as-you-go plan before the next big event.");
  }

  // Retention
  if (m.allTime.repeatPresenters > 0) {
    say("good", "Presenters are coming back", `${m.allTime.repeatPresenters} of ${m.allTime.presenters} presenters have opened rooms on more than one day.`);
  }

  if (!actions.length) actions.push("Keep going: get Roomkey into one more hands-on event next week.");

  const headline = c.realSessions
    ? `${c.attendees} laptops across ${c.realSessions} real session${c.realSessions > 1 ? "s" : ""} this week.`
    : `${c.roomsCreated} room${c.roomsCreated === 1 ? "" : "s"} opened, ${c.attendees} laptop${c.attendees === 1 ? "" : "s"} joined.`;

  return { headline, insights, actions: actions.slice(0, 3) };
}
