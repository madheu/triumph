const { useEffect, useRef, useState } = React;
const DM_BANK = window.DM_BANK_EXT || [];
function DM_drawSession(bank, perSubtest) {
  const groups = {};
  bank.forEach((q) => {
    (groups[q.code] = groups[q.code] || []).push(q);
  });
  const picked = [];
  Object.keys(groups).forEach((code) => {
    const arr = groups[code].slice();
    const n = Math.min(perSubtest, arr.length);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    picked.push(...arr.slice(0, n));
  });
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}
function DM_estimateScore(subtestAccs) {
  const per = subtestAccs.map((a) => 140 + a * 40);
  const avg = per.reduce((x, y) => x + y, 0) / per.length;
  return { per, avg: Math.round(avg) };
}
function DM_passProbability(avgScore) {
  return Math.max(5, Math.min(95, Math.round(5 + (avgScore - 140) * 2.25)));
}
function DM_Nav() {
  return /* @__PURE__ */ React.createElement("header", { className: "nav wrap" }, /* @__PURE__ */ React.createElement("a", { className: "wordmark", href: "/", "aria-label": "Triumph home", style: { textDecoration: "none", color: "inherit" } }, "Triumph", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--accent)" } }, ".")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 20, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { className: "nav-note" }, "Free diagnostic \xB7 12 questions"), /* @__PURE__ */ React.createElement("a", { className: "nav-cta", href: "/" }, "Home")));
}
function DM_Intro({ onStart }) {
  const prevVisit = (() => {
    try {
      const at = Number(localStorage.getItem("triumph_unlocked_at") || 0);
      const pass = Number(localStorage.getItem("triumph_last_pass") || 0);
      if (at && pass) {
        const days = Math.max(0, Math.floor((Date.now() - at) / 864e5));
        return { days, pass };
      }
    } catch (e) {
    }
    return null;
  })();
  return /* @__PURE__ */ React.createElement("section", { className: "intro wrap" }, /* @__PURE__ */ React.createElement("span", { className: "eyebrow" }, "Free readiness diagnostic"), /* @__PURE__ */ React.createElement("h1", null, "Twelve questions. Eight minutes. ", /* @__PURE__ */ React.createElement("em", null, "One honest answer.")), prevVisit && /* @__PURE__ */ React.createElement("div", { className: "intro-return" }, /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, "Welcome back!"), " Your last diagnostic showed a ", /* @__PURE__ */ React.createElement("span", { className: "mono", style: { color: "var(--accent)" } }, prevVisit.pass, "%"), " pass probability", prevVisit.days > 0 ? " \xB7 " + prevVisit.days + " day" + (prevVisit.days === 1 ? "" : "s") + " ago" : "", "."), /* @__PURE__ */ React.createElement("p", { style: { marginBottom: 0 } }, "Re-diagnose now and see how your score moves.")), /* @__PURE__ */ React.createElement("p", null, "We draw twelve questions at random from our growing bank, sampling all four Praxis 5001 subtests \u2014 reading & language arts, mathematics, social studies, and science. At the end you\\u2019ll get an estimated scaled score, your weakest gate, and a pass-probability forecast."), /* @__PURE__ */ React.createElement("p", { style: { marginBottom: 0 } }, "No account. No payment. Original sample questions only."), /* @__PURE__ */ React.createElement("div", { className: "meta" }, /* @__PURE__ */ React.createElement("span", null, "12 random questions"), /* @__PURE__ */ React.createElement("span", null, "\u2248 8 min"), /* @__PURE__ */ React.createElement("span", null, "4 subtests")), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: onStart }, "Begin the diagnostic"));
}
function DM_Quiz({ q, index, total, answered, selected, onSelect, onNext, onPrev, isLast }) {
  return /* @__PURE__ */ React.createElement("section", { className: "quiz wrap" }, /* @__PURE__ */ React.createElement("div", { className: "quiz-top" }, /* @__PURE__ */ React.createElement("span", { className: "quiz-progress-label" }, index + 1, " / ", total), /* @__PURE__ */ React.createElement("span", { className: "quiz-code" }, q.code)), /* @__PURE__ */ React.createElement("div", { className: "progress-track" }, /* @__PURE__ */ React.createElement("div", { className: "progress-fill", style: { width: index / total * 100 + "%" } })), /* @__PURE__ */ React.createElement("h2", null, q.q), q.options.map((opt, i) => {
    let cls = "opt";
    if (answered && selected !== null) {
      if (i === q.answer) cls += " correct";
      else if (i === selected) cls += " wrong";
    } else if (selected === i) {
      cls += " selected";
    }
    return /* @__PURE__ */ React.createElement("button", { key: i, className: cls, onClick: () => !answered && onSelect(i) }, /* @__PURE__ */ React.createElement("span", { className: "opt-key" }, String.fromCharCode(65 + i)), opt);
  }), answered && /* @__PURE__ */ React.createElement("div", { className: "explain" }, /* @__PURE__ */ React.createElement("strong", null, "Why."), " ", q.explain), /* @__PURE__ */ React.createElement("div", { className: "quiz-actions" }, /* @__PURE__ */ React.createElement("button", { className: "btn-text", onClick: onPrev, disabled: index === 0, style: { visibility: index === 0 ? "hidden" : "visible" } }, "\u2190 Back"), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: onNext, disabled: !answered }, isLast ? "See my results" : "Next question \u2192")));
}
function DM_Report({ questions, answers, prevResult, onRestart, onStartLearn }) {
  const accs = questions.map((q) => ({ q, correct: answers[q.id] === q.answer }));
  const bySub = {};
  accs.forEach(({ q, correct }) => {
    if (!bySub[q.subtest]) bySub[q.subtest] = { code: q.code, total: 0, correct: 0 };
    bySub[q.subtest].total += 1;
    if (correct) bySub[q.subtest].correct += 1;
  });
  const subOrder = ["Reading and Language Arts", "Mathematics", "Social Studies", "Science"];
  const subAccs = subOrder.map((s) => bySub[s].correct / bySub[s].total);
  const { per, avg } = DM_estimateScore(subAccs);
  const passPct = DM_passProbability(avg);
  const weakestIdx = subAccs.indexOf(Math.min(...subAccs));
  const [pwStep, setPwStep] = useState(() => {
    try {
      return localStorage.getItem("triumph_unlocked_at") ? "unlocked" : "locked";
    } catch (e) {
      return "locked";
    }
  });
  const [email, setEmail] = useState("");
  const [fname, setFname] = useState("");
  const [emailError, setEmailError] = useState("");
  const submitEmail = () => {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!ok) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailError("");
    try {
      localStorage.setItem("triumph_email", email.trim());
      if (fname.trim()) localStorage.setItem("triumph_name", fname.trim());
      localStorage.setItem("triumph_unlocked_at", String(Date.now()));
    } catch (e) {
    }
    setPwStep("unlocked");
  };
  const savedResult = useRef(false);
  useEffect(() => {
    if (savedResult.current) return;
    savedResult.current = true;
    try {
      localStorage.setItem("triumph_last_score", String(avg));
      localStorage.setItem("triumph_last_pass", String(passPct));
      localStorage.setItem("triumph_last_completed_at", String(Date.now()));
      localStorage.setItem("triumph_weakest", ["5002", "5003", "5004", "5005"][weakestIdx]);
    } catch (e) {
    }
  }, [avg, passPct]);
  return /* @__PURE__ */ React.createElement("section", { className: "report wrap" }, /* @__PURE__ */ React.createElement("span", { className: "eyebrow" }, "Your diagnostic report"), prevResult && /* @__PURE__ */ React.createElement("p", { className: "score-caption", style: { marginTop: 6, padding: "10px 14px", background: "var(--bg-soft)", borderLeft: "2px solid var(--accent)" } }, /* @__PURE__ */ React.createElement("strong", null, "Progress check:"), " last diagnostic ", prevResult.score, " (", prevResult.pass, "%) \u2192 now ", /* @__PURE__ */ React.createElement("span", { className: "mono", style: { color: "var(--accent)" } }, avg), " (", passPct, "%)", avg > prevResult.score ? " \u2014 improving." : avg < prevResult.score ? " \u2014 a dip; the plan adjusts below." : " \u2014 steady."), /* @__PURE__ */ React.createElement("div", { className: "score-head" }, /* @__PURE__ */ React.createElement("span", { className: "big-score" }, avg), /* @__PURE__ */ React.createElement("span", { className: "score-caption" }, "estimated scaled score \xB7 Praxis 5001 (demo model). Passing lines vary by state; a typical line sits near ", /* @__PURE__ */ React.createElement("strong", null, "160"), ".")), /* @__PURE__ */ React.createElement("p", { className: "score-caption", style: { marginTop: 6 } }, "Pass probability (demo): ", /* @__PURE__ */ React.createElement("span", { className: "mono", style: { color: "var(--accent)" } }, passPct, "%"), " \u2014 at or above the passing line on ", passPct >= 50 ? "most" : "fewer than half of", " simulations."), /* @__PURE__ */ React.createElement("div", { className: "section-label" }, /* @__PURE__ */ React.createElement("span", { className: "eyebrow" }, "By subtest")), /* @__PURE__ */ React.createElement("div", { className: "subtest-report" }, subOrder.map((s, i) => {
    const acc = subAccs[i];
    const isWeak = i === weakestIdx;
    return /* @__PURE__ */ React.createElement("div", { className: "subtest-line", key: s }, /* @__PURE__ */ React.createElement("span", { className: "code" }, bySub[s].code), /* @__PURE__ */ React.createElement("span", { className: "name" }, s, isWeak ? " \u2014 weakest gate" : ""), /* @__PURE__ */ React.createElement("span", { className: "acc" }, Math.round(acc * 100), "%"), /* @__PURE__ */ React.createElement("div", { className: "bar-track" }, /* @__PURE__ */ React.createElement("div", { className: "bar-fill", style: { width: Math.max(6, acc * 100) + "%" } })));
  })), /* @__PURE__ */ React.createElement("p", { className: "weak-note" }, "Your weakest gate is ", /* @__PURE__ */ React.createElement("em", null, subOrder[weakestIdx]), " \u2014 this is the subtest most likely to fail you on test day, and where most of your study time should go."), /* @__PURE__ */ React.createElement("div", { className: "paywall" }, /* @__PURE__ */ React.createElement("div", { className: "locked-head" }, /* @__PURE__ */ React.createElement("span", { className: "eyebrow", style: { margin: 0 } }, "Pass forecast & study plan"), /* @__PURE__ */ React.createElement("span", { className: "lock-tag" }, "\u25CF TRIUMPH")), pwStep === "locked" ? /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "locked-content" }, /* @__PURE__ */ React.createElement("div", { className: "mock-line w70" }), /* @__PURE__ */ React.createElement("div", { className: "mock-line" }), /* @__PURE__ */ React.createElement("div", { className: "mock-line w50" })), /* @__PURE__ */ React.createElement("div", { className: "cta-row" }, /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: () => setPwStep("email") }, "Unlock my pass forecast"), /* @__PURE__ */ React.createElement("span", { className: "price" }, "$15", /* @__PURE__ */ React.createElement("small", null, "/mo"))), /* @__PURE__ */ React.createElement("p", { className: "demo-note" }, "A real retake costs ~$130 and 28 days. The forecast costs less than a coffee a week. (Prototype \u2014 payment not wired yet.)")) : pwStep === "email" ? /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "score-caption", style: { marginBottom: 16 } }, "Enter your email to unlock your ", /* @__PURE__ */ React.createElement("strong", null, "pass forecast"), " and ", /* @__PURE__ */ React.createElement("strong", null, "personalized study plan"), ". Free to start \u2014 you'll see the full report immediately."), /* @__PURE__ */ React.createElement("div", { className: "pw-form" }, /* @__PURE__ */ React.createElement("div", { className: "pw-field" }, /* @__PURE__ */ React.createElement("label", { className: "pw-label" }, "Email"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "pw-input",
      type: "email",
      placeholder: "you@example.com",
      value: email,
      onChange: (e) => setEmail(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter") submitEmail();
      }
    }
  ), emailError && /* @__PURE__ */ React.createElement("div", { className: "pw-error" }, emailError)), /* @__PURE__ */ React.createElement("div", { className: "pw-field" }, /* @__PURE__ */ React.createElement("label", { className: "pw-label" }, "First name ", /* @__PURE__ */ React.createElement("span", { style: { opacity: 0.6 } }, "(optional)")), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "pw-input",
      type: "text",
      placeholder: "Alex",
      value: fname,
      onChange: (e) => setFname(e.target.value)
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "cta-row", style: { marginTop: 18 } }, /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: submitEmail }, "Unlock my pass forecast"), /* @__PURE__ */ React.createElement("span", { className: "price" }, "$15", /* @__PURE__ */ React.createElement("small", null, "/mo"))), /* @__PURE__ */ React.createElement("p", { className: "pw-privacy" }, "14-day free trial \xB7 cancel anytime \xB7 we never share your email. (Prototype: this demo saves your email to this browser only \u2014 nothing is sent anywhere yet.)"))) : /* @__PURE__ */ React.createElement("div", { className: "unlocked-box", style: { marginTop: 24 } }, /* @__PURE__ */ React.createElement("h3", null, fname.trim() ? "Welcome, " + fname.trim() + " \u2014 " : "Welcome \u2014 ", "here's your pass forecast ", /* @__PURE__ */ React.createElement("em", null, "(unlocked)")), /* @__PURE__ */ React.createElement("p", { className: "score-caption", style: { marginBottom: 16 } }, "Based on this diagnostic, we estimate a ", /* @__PURE__ */ React.createElement("span", { className: "mono", style: { color: "var(--accent)" } }, passPct, "%"), "chance of passing at your current level. Your weakest gate (", subOrder[weakestIdx], ") should get about 60% of your study time. Sample week:"), /* @__PURE__ */ React.createElement("div", { className: "plan-item" }, /* @__PURE__ */ React.createElement("span", { className: "day" }, "MON"), " 5003 Mathematics \u2014 fractions & decimals (20 min) + 8 practice questions"), /* @__PURE__ */ React.createElement("div", { className: "plan-item" }, /* @__PURE__ */ React.createElement("span", { className: "day" }, "TUE"), " ", subOrder[weakestIdx], " \u2014 targeted review of missed concepts (25 min)"), /* @__PURE__ */ React.createElement("div", { className: "plan-item" }, /* @__PURE__ */ React.createElement("span", { className: "day" }, "WED"), " Mixed 10-question set across all four subtests"), /* @__PURE__ */ React.createElement("div", { className: "plan-item" }, /* @__PURE__ */ React.createElement("span", { className: "day" }, "THU"), " ", subOrder[weakestIdx], " \u2014 timed micro-quiz (10 questions, 12 min)"), /* @__PURE__ */ React.createElement("div", { className: "plan-item" }, /* @__PURE__ */ React.createElement("span", { className: "day" }, "FRI"), " 5002 Reading & Language Arts \u2014 vocabulary & phonics review"), /* @__PURE__ */ React.createElement("div", { className: "plan-item" }, /* @__PURE__ */ React.createElement("span", { className: "day" }, "SAT"), " Full simulated subtest, timed, no notes"), /* @__PURE__ */ React.createElement("div", { className: "plan-item" }, /* @__PURE__ */ React.createElement("span", { className: "day" }, "SUN"), " Rest + re-diagnose to measure improvement"), /* @__PURE__ */ React.createElement("p", { className: "pw-privacy", style: { marginTop: 18, marginBottom: 0 } }, /* @__PURE__ */ React.createElement("strong", null, "Come back next week."), " Re-run this diagnostic in 7 days and watch your pass probability move \u2014 your score history is saved on this device so you can compare."), /* @__PURE__ */ React.createElement("div", { className: "cta-row", style: { marginTop: 20 } }, /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: onStartLearn }, "Start your daily study \u2192"), /* @__PURE__ */ React.createElement("a", { className: "btn-ghost", href: "/dashboard", style: { textDecoration: "none", display: "inline-block", padding: "13px 20px" } }, "Dashboard"), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", onClick: onRestart }, "Re-run diagnostic"), /* @__PURE__ */ React.createElement("span", { className: "demo-note", style: { margin: 0 } }, "Prototype \u2014 real accounts & billing pending.")))));
}
function DM_Learn({ weakestCode, weakestName, onBack, onRestart }) {
  const [tab, setTab] = useState("tasks");
  const shuffle = (a) => {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  const [taskQs] = useState(() => {
    const weak = shuffle(DM_BANK.filter((q) => q.code === weakestCode));
    const rest = shuffle(DM_BANK.filter((q) => q.code !== weakestCode));
    return [...weak.slice(0, 5), ...rest.slice(0, 3)].slice(0, 8);
  });
  const [tIndex, setTIndex] = useState(0);
  const [tSelected, setTSelected] = useState(null);
  const [tAnswered, setTAnswered] = useState(false);
  const [tDone, setTDone] = useState(0);
  const [tCorrect, setTCorrect] = useState(0);
  const [wrongIds, setWrongIds] = useState([]);
  const tq = taskQs[tIndex];
  const cardIds = [...new Set(wrongIds)];
  const cardQs = cardIds.map((id) => DM_BANK.find((q) => q.id === id)).filter(Boolean);
  const [reviewed, setReviewed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("triumph_reviewed") || "[]");
    } catch (e) {
      return [];
    }
  });
  const selectTask = (i) => {
    if (tAnswered) return;
    setTSelected(i);
    setTAnswered(true);
    if (i === tq.answer) setTCorrect((c) => c + 1);
    else setWrongIds((w) => [...w, tq.id]);
  };
  const nextTask = () => {
    setTDone((d) => d + 1);
    if (tIndex < taskQs.length - 1) {
      setTIndex((i) => i + 1);
      setTSelected(null);
      setTAnswered(false);
    } else setTab("cards");
  };
  const markReviewed = (id) => {
    const next = reviewed.includes(id) ? reviewed : [...reviewed, id];
    setReviewed(next);
    try {
      localStorage.setItem("triumph_reviewed", JSON.stringify(next));
    } catch (e) {
    }
  };
  return /* @__PURE__ */ React.createElement("section", { className: "learn wrap" }, /* @__PURE__ */ React.createElement("span", { className: "eyebrow" }, "Learning mode \xB7 ", weakestName, " is your weakest gate"), /* @__PURE__ */ React.createElement("h2", { style: { fontFamily: "var(--serif)", fontWeight: 400, fontSize: "clamp(26px,3.4vw,34px)", lineHeight: 1.2, marginTop: 10 } }, tab === "tasks" && "Today\u2019s tasks", tab === "cards" && "Memory cards", tab === "progress" && "Your progress"), /* @__PURE__ */ React.createElement("div", { className: "learn-tabs" }, /* @__PURE__ */ React.createElement("button", { className: "learn-tab" + (tab === "tasks" ? " active" : ""), onClick: () => setTab("tasks") }, "Tasks"), /* @__PURE__ */ React.createElement("button", { className: "learn-tab" + (tab === "cards" ? " active" : ""), onClick: () => setTab("cards") }, "Cards (", cardQs.length, ")"), /* @__PURE__ */ React.createElement("button", { className: "learn-tab" + (tab === "progress" ? " active" : ""), onClick: () => setTab("progress") }, "Progress")), tab === "tasks" && tq && /* @__PURE__ */ React.createElement(DM_Quiz, { q: tq, index: tIndex, total: taskQs.length, answered: tAnswered, selected: tSelected, onSelect: selectTask, onNext: nextTask, onPrev: () => {
  }, isLast: false }), tab === "cards" && /* @__PURE__ */ React.createElement("div", null, cardQs.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "score-caption" }, "No missed questions yet \u2014 complete today\u2019s tasks first.") : cardQs.map((c) => {
    const done = reviewed.includes(c.id);
    return /* @__PURE__ */ React.createElement("div", { className: "card-item", key: c.id }, /* @__PURE__ */ React.createElement("div", { className: "card-q" }, c.q), done ? /* @__PURE__ */ React.createElement("p", { className: "card-reveal" }, "Correct answer: ", /* @__PURE__ */ React.createElement("strong", null, c.options[c.answer]), " \xB7 ", c.explain, " ", /* @__PURE__ */ React.createElement("span", { className: "done-tag" }, "\u2713 reviewed")) : /* @__PURE__ */ React.createElement("button", { className: "btn-sm btn-ghost", onClick: () => {
      alert("Answer: " + c.options[c.answer] + "\n\n" + c.explain);
      markReviewed(c.id);
    } }, "Reveal answer"));
  })), tab === "progress" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "learn-summary" }, /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, "Today:"), " ", tDone, " of ", taskQs.length, " tasks completed \xB7 ", tCorrect, " correct"), /* @__PURE__ */ React.createElement("p", { style: { marginBottom: 0 } }, "Re-run the diagnostic next week to measure movement.")), /* @__PURE__ */ React.createElement("div", { className: "cta-row" }, /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: onRestart }, "New diagnostic"), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", onClick: onBack }, "Back to report"))));
}
function DM_App() {
  const [stage, setStage] = useState("intro");
  const [session, setSession] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [answers, setAnswers] = useState({});
  const [comparisonBase, setComparisonBase] = useState(null);
  const total = session.length;
  const q = session[qIndex];
  const weakest = (() => {
    const bySub = {};
    session.forEach((sq) => {
      if (!bySub[sq.subtest]) bySub[sq.subtest] = { total: 0, correct: 0 };
      bySub[sq.subtest].total++;
      if (answers[sq.id] === sq.answer) bySub[sq.subtest].correct++;
    });
    let worst = null, worstRate = 1;
    Object.keys(bySub).forEach((k) => {
      const r = bySub[k].total ? bySub[k].correct / bySub[k].total : 1;
      if (r < worstRate) {
        worstRate = r;
        worst = k;
      }
    });
    return worst || "5003";
  })();
  const weakNameMap = { "5002": "Reading & Language Arts", "5003": "Mathematics", "5004": "Social Studies", "5005": "Science" };
  const start = () => {
    try {
      const score = Number(localStorage.getItem("triumph_last_score") || 0);
      const pass = Number(localStorage.getItem("triumph_last_pass") || 0);
      setComparisonBase(score > 0 ? { score, pass } : null);
    } catch (e) {
      setComparisonBase(null);
    }
    const focusSub = new URLSearchParams(window.location.search).get("subtest");
    if (focusSub && DM_BANK.some((q2) => q2.code === focusSub)) {
      const pool = DM_BANK.filter((q2) => q2.code === focusSub);
      const sh = (a) => {
        const x = a.slice();
        for (let i = x.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [x[i], x[j]] = [x[j], x[i]];
        }
        return x;
      };
      setSession(sh(pool).slice(0, 12));
    } else {
      setSession(DM_drawSession(DM_BANK, 3));
    }
    setStage("quiz");
  };
  const select = (i) => {
    setSelected(i);
    setAnswered(true);
    setAnswers({ ...answers, [q.id]: i });
  };
  const next = () => {
    if (qIndex < total - 1) {
      setQIndex(qIndex + 1);
      setSelected(null);
      setAnswered(false);
    } else setStage("report");
  };
  const prev = () => {
    if (qIndex > 0) {
      setQIndex(qIndex - 1);
      setSelected(null);
      setAnswered(false);
    }
  };
  const restart = () => {
    setStage("intro");
    setQIndex(0);
    setSelected(null);
    setAnswered(false);
    setAnswers({});
  };
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(DM_Nav, null), stage === "intro" && /* @__PURE__ */ React.createElement(DM_Intro, { onStart: start }), stage === "quiz" && total > 0 && /* @__PURE__ */ React.createElement(
    DM_Quiz,
    {
      q,
      index: qIndex,
      total,
      answered,
      selected,
      onSelect: select,
      onNext: next,
      onPrev: prev,
      isLast: qIndex === total - 1
    }
  ), stage === "report" && /* @__PURE__ */ React.createElement(DM_Report, { questions: session, answers, prevResult: comparisonBase, onRestart: restart, onStartLearn: () => setStage("learn") }), stage === "learn" && /* @__PURE__ */ React.createElement(DM_Learn, { weakestCode: weakest, weakestName: weakNameMap[weakest] || weakest, onBack: () => setStage("report"), onRestart: restart }), /* @__PURE__ */ React.createElement("footer", { className: "footer wrap" }, /* @__PURE__ */ React.createElement("p", null, "Triumph is an independent study tool. Not affiliated with, endorsed by, or sponsored by ETS. Sample questions are original demonstrations and are not official Praxis items.")));
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(/* @__PURE__ */ React.createElement(DM_App, null));
