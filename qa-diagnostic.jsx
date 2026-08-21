
    const { useEffect, useRef, useState } = React;

    // ============ QUESTION BANK (original, blueprint-aligned) ============
    // 来源: Hermes + praxis-question-writer skill, 基于 ETS 官方 Study Companion 大纲
    // 科目代码按官方: 5002 = Reading & Language Arts, 5003 = Mathematics,
    //                 5004 = Social Studies, 5005 = Science
    // 每次诊断从 DM_BANK 随机抽取（每科 3 题），见 DM_drawSession · 题库 86 题（template3，官方蓝图）
    const DM_BANK = window.DM_BANK_EXT || []; // 题库来自 questions.js（build-questions-js.js 生成）

    // Draw a session: perSubtest items per subtest, then shuffle across all four
    function DM_drawSession(bank, perSubtest) {
      const groups = {};
      bank.forEach(q => { (groups[q.code] = groups[q.code] || []).push(q); });
      const picked = [];
      Object.keys(groups).forEach(code => {
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

    // mock scaled-score model (demo only)
    function DM_estimateScore(subtestAccs) {
      // per-subtest: acc 0..1 -> ~140..180; average of four
      const per = subtestAccs.map(a => 140 + a * 40);
      const avg = per.reduce((x, y) => x + y, 0) / per.length;
      return { per, avg: Math.round(avg) };
    }
    function DM_passProbability(avgScore) {
      // mock: 160 is demo passing line; 140..180 maps to 5%..95%
      return Math.max(5, Math.min(95, Math.round(5 + (avgScore - 140) * 2.25)));
    }

    function DM_Nav() {
      return (
        <header className="nav wrap">
          <a className="wordmark" href="/" aria-label="Triumph home" style={{textDecoration:'none', color:'inherit'}}>Triumph<span style={{color:'var(--accent)'}}>.</span></a>
          <div style={{display:'flex', gap:20, alignItems:'baseline'}}>
            <span className="nav-note">Free diagnostic · 12 questions</span>
            <a className="nav-cta" href="/">Home</a>
          </div>
        </header>
      );
    }

    function DM_Intro({ onStart }) {
      // 重访检测：之前解锁过？上次通过概率多少？
      const prevVisit = (() => {
        try {
          const at = Number(localStorage.getItem('triumph_unlocked_at') || 0);
          const pass = Number(localStorage.getItem('triumph_last_pass') || 0);
          if (at && pass) {
            const days = Math.max(0, Math.floor((Date.now() - at) / 86400000));
            return { days, pass };
          }
        } catch (e) {}
        return null;
      })();
      return (
        <section className="intro wrap">
          <span className="eyebrow">Free readiness diagnostic</span>
          <h1>Twelve questions. Eight minutes. <em>One honest answer.</em></h1>
          {prevVisit && (
            <div className="intro-return">
              <p><strong>Welcome back!</strong> Your last diagnostic showed a <span className="mono" style={{color:'var(--accent)'}}>{prevVisit.pass}%</span> pass probability{prevVisit.days > 0 ? ' · ' + prevVisit.days + ' day' + (prevVisit.days === 1 ? '' : 's') + ' ago' : ''}.</p>
              <p style={{marginBottom:0}}>Re-diagnose now and see how your score moves.</p>
            </div>
          )}
          <p>
            We draw twelve questions at random from our growing bank, sampling all four Praxis 5001
            subtests — reading &amp; language arts, mathematics, social studies, and science. At the end
            you\u2019ll get an estimated scaled score, your weakest gate, and a pass-probability forecast.
          </p>
          <p style={{marginBottom:0}}>No account. No payment. Original sample questions only.</p>
          <div className="meta">
            <span>12 random questions</span><span>≈ 8 min</span><span>4 subtests</span>
          </div>
          <button className="btn-primary" onClick={onStart}>Begin the diagnostic</button>
        </section>
      );
    }

    function DM_Quiz({ q, index, total, answered, selected, onSelect, onNext, onPrev, isLast }) {
      return (
        <section className="quiz wrap">
          <div className="quiz-top">
            <span className="quiz-progress-label">{index + 1} / {total}</span>
            <span className="quiz-code">{q.code}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: (index / total * 100) + '%' }} />
          </div>
          <h2>{q.q}</h2>
          {q.options.map((opt, i) => {
            let cls = 'opt';
            if (answered && selected !== null) {
              if (i === q.answer) cls += ' correct';
              else if (i === selected) cls += ' wrong';
            } else if (selected === i) {
              cls += ' selected';
            }
            return (
              <button key={i} className={cls} onClick={() => !answered && onSelect(i)}>
                <span className="opt-key">{String.fromCharCode(65 + i)}</span>{opt}
              </button>
            );
          })}
          {answered && (
            <div className="explain"><strong>Why.</strong> {q.explain}</div>
          )}
          <div className="quiz-actions">
            <button className="btn-text" onClick={onPrev} disabled={index === 0} style={{visibility: index === 0 ? 'hidden' : 'visible'}}>← Back</button>
            <button className="btn-primary" onClick={onNext} disabled={!answered}>
              {isLast ? 'See my results' : 'Next question →'}
            </button>
          </div>
        </section>
      );
    }

    function DM_Report({ questions, answers, prevResult, onRestart, onStartLearn }) {
      const accs = questions.map(q => ({ q, correct: answers[q.id] === q.answer }));
      const bySub = {};
      accs.forEach(({ q, correct }) => {
        if (!bySub[q.subtest]) bySub[q.subtest] = { code: q.code, total: 0, correct: 0 };
        bySub[q.subtest].total += 1;
        if (correct) bySub[q.subtest].correct += 1;
      });
      const subOrder = ['Reading and Language Arts', 'Mathematics', 'Social Studies', 'Science'];
      const subAccs = subOrder.map(s => bySub[s].correct / bySub[s].total);
      const { per, avg } = DM_estimateScore(subAccs);
      const passPct = DM_passProbability(avg);
      const weakestIdx = subAccs.indexOf(Math.min(...subAccs));

      const [pwStep, setPwStep] = useState(() => {
        // 已解锁用户（本设备留过邮箱）重诊时直接解锁，不再过付费墙
        try { return localStorage.getItem('triumph_unlocked_at') ? 'unlocked' : 'locked'; } catch (e) { return 'locked'; }
      });
      const [email, setEmail] = useState('');
      const [fname, setFname] = useState('');
      const [emailError, setEmailError] = useState('');

      const submitEmail = () => {
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
        if (!ok) { setEmailError('Please enter a valid email address.'); return; }
        setEmailError('');
        try {
          localStorage.setItem('triumph_email', email.trim());
          if (fname.trim()) localStorage.setItem('triumph_name', fname.trim());
          localStorage.setItem('triumph_unlocked_at', String(Date.now()));
        } catch (e) {}
        setPwStep('unlocked');
      };

      const savedResult = useRef(false);
      useEffect(() => {
        if (savedResult.current) return;
        savedResult.current = true;
        try {
          localStorage.setItem('triumph_last_score', String(avg));
          localStorage.setItem('triumph_last_pass', String(passPct));
          localStorage.setItem('triumph_last_completed_at', String(Date.now()));
          localStorage.setItem('triumph_weakest', ['5002','5003','5004','5005'][weakestIdx]);
        } catch (e) {}
      }, [avg, passPct]);

      return (
        <section className="report wrap">
          <span className="eyebrow">Your diagnostic report</span>
          {prevResult && (
            <p className="score-caption" style={{marginTop:6, padding:'10px 14px', background:'var(--bg-soft)', borderLeft:'2px solid var(--accent)'}}>
              <strong>Progress check:</strong> last diagnostic {prevResult.score} ({prevResult.pass}%) → now <span className="mono" style={{color:'var(--accent)'}}>{avg}</span> ({passPct}%)
              {avg > prevResult.score ? ' — improving.' : avg < prevResult.score ? ' — a dip; the plan adjusts below.' : ' — steady.'}
            </p>
          )}
          <div className="score-head">
            <span className="big-score">{avg}</span>
            <span className="score-caption">
              estimated scaled score · Praxis 5001 (demo model). Passing lines vary by state;
              a typical line sits near <strong>160</strong>.
            </span>
          </div>
          <p className="score-caption" style={{marginTop:6}}>
            Pass probability (demo): <span className="mono" style={{color:'var(--accent)'}}>{passPct}%</span> — at or above the passing line on {passPct >= 50 ? 'most' : 'fewer than half of'} simulations.
          </p>

          <div className="section-label">
            <span className="eyebrow">By subtest</span>
          </div>
          <div className="subtest-report">
            {subOrder.map((s, i) => {
              const acc = subAccs[i];
              const isWeak = i === weakestIdx;
              return (
                <div className="subtest-line" key={s}>
                  <span className="code">{bySub[s].code}</span>
                  <span className="name">{s}{isWeak ? ' — weakest gate' : ''}</span>
                  <span className="acc">{Math.round(acc * 100)}%</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: Math.max(6, acc * 100) + '%' }} />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="weak-note">
            Your weakest gate is <em>{subOrder[weakestIdx]}</em> — this is the subtest most likely to fail you
            on test day, and where most of your study time should go.
          </p>

          {/* ---- Paywall ---- */}
          <div className="paywall">
            <div className="locked-head">
              <span className="eyebrow" style={{margin:0}}>Pass forecast &amp; study plan</span>
              <span className="lock-tag">● TRIUMPH</span>
            </div>
            {pwStep === 'locked' ? (
              <div>
                <div className="locked-content">
                  <div className="mock-line w70" /><div className="mock-line" /><div className="mock-line w50" />
                </div>
                <div className="cta-row">
                  <button className="btn-primary" onClick={() => setPwStep('email')}>Unlock my pass forecast</button>
                  <span className="price">$15<small>/mo</small></span>
                </div>
                <p className="demo-note">
                  A real retake costs ~$130 and 28 days. The forecast costs less than a coffee a week.
                  (Prototype — payment not wired yet.)
                </p>
              </div>
            ) : pwStep === 'email' ? (
              <div>
                <p className="score-caption" style={{marginBottom:16}}>
                  Enter your email to unlock your <strong>pass forecast</strong> and <strong>personalized study plan</strong>.
                  Free to start — you'll see the full report immediately.
                </p>
                <div className="pw-form">
                  <div className="pw-field">
                    <label className="pw-label">Email</label>
                    <input className="pw-input" type="email" placeholder="you@example.com" value={email}
                      onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitEmail(); }} />
                    {emailError && <div className="pw-error">{emailError}</div>}
                  </div>
                  <div className="pw-field">
                    <label className="pw-label">First name <span style={{opacity:.6}}>(optional)</span></label>
                    <input className="pw-input" type="text" placeholder="Alex" value={fname}
                      onChange={e => setFname(e.target.value)} />
                  </div>
                  <div className="cta-row" style={{marginTop:18}}>
                    <button className="btn-primary" onClick={submitEmail}>Unlock my pass forecast</button>
                    <span className="price">$15<small>/mo</small></span>
                  </div>
                  <p className="pw-privacy">
                    14-day free trial · cancel anytime · we never share your email.
                    (Prototype: this demo saves your email to this browser only — nothing is sent anywhere yet.)
                  </p>
                </div>
              </div>
            ) : (
              <div className="unlocked-box" style={{marginTop:24}}>
                <h3>{fname.trim() ? 'Welcome, ' + fname.trim() + ' — ' : 'Welcome — '}here's your pass forecast <em>(unlocked)</em></h3>
                <p className="score-caption" style={{marginBottom:16}}>
                  Based on this diagnostic, we estimate a <span className="mono" style={{color:'var(--accent)'}}>{passPct}%</span>
                  chance of passing at your current level. Your weakest gate ({subOrder[weakestIdx]}) should get
                  about 60% of your study time. Sample week:
                </p>
                <div className="plan-item"><span className="day">MON</span> 5003 Mathematics — fractions &amp; decimals (20 min) + 8 practice questions</div>
                <div className="plan-item"><span className="day">TUE</span> {subOrder[weakestIdx]} — targeted review of missed concepts (25 min)</div>
                <div className="plan-item"><span className="day">WED</span> Mixed 10-question set across all four subtests</div>
                <div className="plan-item"><span className="day">THU</span> {subOrder[weakestIdx]} — timed micro-quiz (10 questions, 12 min)</div>
                <div className="plan-item"><span className="day">FRI</span> 5002 Reading &amp; Language Arts — vocabulary &amp; phonics review</div>
                <div className="plan-item"><span className="day">SAT</span> Full simulated subtest, timed, no notes</div>
                <div className="plan-item"><span className="day">SUN</span> Rest + re-diagnose to measure improvement</div>
                <p className="pw-privacy" style={{marginTop:18, marginBottom:0}}>
                  <strong>Come back next week.</strong> Re-run this diagnostic in 7 days and watch your pass probability move —
                  your score history is saved on this device so you can compare.
                </p>
                <div className="cta-row" style={{marginTop:20}}>
                  <button className="btn-primary" onClick={onStartLearn}>Start your daily study →</button>
                  <a className="btn-ghost" href="/dashboard" style={{textDecoration:'none',display:'inline-block',padding:'13px 20px'}}>Dashboard</a>
                  <button className="btn-ghost" onClick={onRestart}>Re-run diagnostic</button>
                  <span className="demo-note" style={{margin:0}}>Prototype — real accounts &amp; billing pending.</span>
                </div>
              </div>
            )}
          </div>
        </section>
      );
    }

    function DM_Learn({ weakestCode, weakestName, onBack, onRestart }) {
      const [tab, setTab] = useState('tasks');
      const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
      const [taskQs] = useState(() => {
        const weak = shuffle(DM_BANK.filter(q => q.code === weakestCode));
        const rest = shuffle(DM_BANK.filter(q => q.code !== weakestCode));
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
      const cardQs = cardIds.map(id => DM_BANK.find(q => q.id === id)).filter(Boolean);
      const [reviewed, setReviewed] = useState(() => { try { return JSON.parse(localStorage.getItem('triumph_reviewed') || '[]'); } catch (e) { return []; } });
      const selectTask = i => {
        if (tAnswered) return;
        setTSelected(i); setTAnswered(true);
        if (i === tq.answer) setTCorrect(c => c + 1); else setWrongIds(w => [...w, tq.id]);
      };
      const nextTask = () => {
        setTDone(d => d + 1);
        if (tIndex < taskQs.length - 1) { setTIndex(i => i + 1); setTSelected(null); setTAnswered(false); }
        else setTab('cards');
      };
      const markReviewed = id => {
        const next = reviewed.includes(id) ? reviewed : [...reviewed, id];
        setReviewed(next); try { localStorage.setItem('triumph_reviewed', JSON.stringify(next)); } catch (e) {}
      };
      return (
        <section className="learn wrap">
          <span className="eyebrow">Learning mode · {weakestName} is your weakest gate</span>
          <h2 style={{fontFamily:'var(--serif)',fontWeight:400,fontSize:'clamp(26px,3.4vw,34px)',lineHeight:1.2,marginTop:10}}>
            {tab === 'tasks' && 'Today\u2019s tasks'}{tab === 'cards' && 'Memory cards'}{tab === 'progress' && 'Your progress'}
          </h2>
          <div className="learn-tabs">
            <button className={'learn-tab' + (tab === 'tasks' ? ' active' : '')} onClick={() => setTab('tasks')}>Tasks</button>
            <button className={'learn-tab' + (tab === 'cards' ? ' active' : '')} onClick={() => setTab('cards')}>Cards ({cardQs.length})</button>
            <button className={'learn-tab' + (tab === 'progress' ? ' active' : '')} onClick={() => setTab('progress')}>Progress</button>
          </div>
          {tab === 'tasks' && tq && <DM_Quiz q={tq} index={tIndex} total={taskQs.length} answered={tAnswered} selected={tSelected} onSelect={selectTask} onNext={nextTask} onPrev={() => {}} isLast={false} />}
          {tab === 'cards' && <div>{cardQs.length === 0 ? <p className="score-caption">No missed questions yet — complete today’s tasks first.</p> : cardQs.map(c => {
            const done = reviewed.includes(c.id);
            return <div className="card-item" key={c.id}><div className="card-q">{c.q}</div>{done ? <p className="card-reveal">Correct answer: <strong>{c.options[c.answer]}</strong> · {c.explain} <span className="done-tag">✓ reviewed</span></p> : <button className="btn-sm btn-ghost" onClick={() => { alert('Answer: ' + c.options[c.answer] + '\n\n' + c.explain); markReviewed(c.id); }}>Reveal answer</button>}</div>;
          })}</div>}
          {tab === 'progress' && <div><div className="learn-summary"><p><strong>Today:</strong> {tDone} of {taskQs.length} tasks completed · {tCorrect} correct</p><p style={{marginBottom:0}}>Re-run the diagnostic next week to measure movement.</p></div><div className="cta-row"><button className="btn-primary" onClick={onRestart}>New diagnostic</button><button className="btn-ghost" onClick={onBack}>Back to report</button></div></div>}
        </section>
      );
    }

    function DM_App() {
      const [stage, setStage] = useState('intro'); // intro | quiz | report | learn
      const [session, setSession] = useState([]);
      const [qIndex, setQIndex] = useState(0);
      const [selected, setSelected] = useState(null);
      const [answered, setAnswered] = useState(false);
      const [answers, setAnswers] = useState({});
      const [comparisonBase, setComparisonBase] = useState(null);

      const total = session.length;
      const q = session[qIndex];

      // 最弱门计算（从本次诊断结果）
      const weakest = (() => {
        const bySub = {};
        session.forEach(sq => {
          if (!bySub[sq.subtest]) bySub[sq.subtest] = { total: 0, correct: 0 };
          bySub[sq.subtest].total++;
          if (answers[sq.id] === sq.answer) bySub[sq.subtest].correct++;
        });
        let worst = null, worstRate = 1;
        Object.keys(bySub).forEach(k => {
          const r = bySub[k].total ? bySub[k].correct / bySub[k].total : 1;
          if (r < worstRate) { worstRate = r; worst = k; }
        });
        return worst || '5003';
      })();
      const weakNameMap = { '5002': 'Reading & Language Arts', '5003': 'Mathematics', '5004': 'Social Studies', '5005': 'Science' };

      const start = () => {
        try {
          const score = Number(localStorage.getItem('triumph_last_score') || 0);
          const pass = Number(localStorage.getItem('triumph_last_pass') || 0);
          setComparisonBase(score > 0 ? { score, pass } : null);
        } catch (e) { setComparisonBase(null); }
        // 支持 ?subtest=5002 等：只做该科目的题（来自 Dashboard 做题链接）
        const focusSub = new URLSearchParams(window.location.search).get('subtest');
        if (focusSub && DM_BANK.some(q => q.code === focusSub)) {
          const pool = DM_BANK.filter(q => q.code === focusSub);
          const sh = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
          setSession(sh(pool).slice(0, 12));
        } else {
          setSession(DM_drawSession(DM_BANK, 3));
        }
        setStage('quiz');
      };
      const select = i => { setSelected(i); setAnswered(true); setAnswers({ ...answers, [q.id]: i }); };
      const next = () => {
        if (qIndex < total - 1) { setQIndex(qIndex + 1); setSelected(null); setAnswered(false); }
        else setStage('report');
      };
      const prev = () => { if (qIndex > 0) { setQIndex(qIndex - 1); setSelected(null); setAnswered(false); } };
      const restart = () => { setStage('intro'); setQIndex(0); setSelected(null); setAnswered(false); setAnswers({}); };

      return (
        <div>
          <DM_Nav />
          {stage === 'intro' && <DM_Intro onStart={start} />}
          {stage === 'quiz' && total > 0 && (
            <DM_Quiz q={q} index={qIndex} total={total} answered={answered} selected={selected}
              onSelect={select} onNext={next} onPrev={prev} isLast={qIndex === total - 1} />
          )}
          {stage === 'report' && <DM_Report questions={session} answers={answers} prevResult={comparisonBase} onRestart={restart} onStartLearn={() => setStage('learn')} />}
          {stage === 'learn' && <DM_Learn weakestCode={weakest} weakestName={weakNameMap[weakest] || weakest} onBack={() => setStage('report')} onRestart={restart} />}
          
          <footer className="footer wrap">
            <p>
              Triumph is an independent study tool. Not affiliated with, endorsed by, or sponsored by ETS.
              Sample questions are original demonstrations and are not official Praxis items.
            </p>
          </footer>
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<DM_App />);
  