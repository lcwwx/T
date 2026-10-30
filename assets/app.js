/* ==========================================================================
   听见 · CET 听力实验室
   纯前端应用：内置音频 / 答题 / 精听对比 / 本地录音 / 学习记录
   ========================================================================== */
(function () {
  "use strict";

  const D = window.CET_DATA;
  if (!D) {
    document.getElementById("app").innerHTML = "<p style='padding:40px'>题库加载失败，请确认 assets/data.js 存在。</p>";
    return;
  }

  const app = document.getElementById("app");
  const STORAGE_KEY = "tingjian-cet-listening-v1";
  const DAILY_QUOTE = {
    en: "The goal is not productivity for its own sake, but the freedom to choose what deserves our attention.",
    zh: "目标不是为效率而效率，而是拥有选择「什么值得我关注」的自由。",
    source: "The Attention Economy · CET-6 讲座"
  };
  const WEEK_EN = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];
  const MONTH_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  /* ------------------------------------------------------------------ data */
  function defaultStore() {
    return {
      version: 1,
      settings: { level: 4, voiceURI: "" },
      days: {},
      attempts: [],
      totals: { answered: 0, correct: 0, sessions: 0 }
    };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultStore();
      const parsed = JSON.parse(raw);
      const base = defaultStore();
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        totals: { ...base.totals, ...(parsed.totals || {}) },
        days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
        attempts: Array.isArray(parsed.attempts) ? parsed.attempts : []
      };
    } catch (error) {
      console.warn("读取学习记录失败：", error);
      return defaultStore();
    }
  }

  let store = loadStore();
  const state = {
    view: "home",
    level: Number(store.settings.level) === 6 ? 6 : 4,
    voiceURI: store.settings.voiceURI || "",
    libraryFilter: "全部",
    practice: null,
    intensive: { index: 0, input: "", checked: false, revealed: false, result: null, slow: false, loop: false },
    shadow: { index: 0, isRecording: false, blobUrl: "", checks: [false, false, false] },
    confirmReset: false
  };

  /* --------------------------------------------------------------- utilities */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pad2(number) {
    return String(number).padStart(2, "0");
  }

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function dayRecord(create = false) {
    const key = dateKey();
    if (!store.days[key] && create) {
      store.days[key] = { minutes: 0, completed: [], dictations: [] };
    }
    return store.days[key] || { minutes: 0, completed: [], dictations: [] };
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      console.warn("保存学习记录失败：", error);
    }
    syncChrome();
  }

  function addMinutes(minutes, route) {
    const day = dayRecord(true);
    day.minutes = (Number(day.minutes) || 0) + minutes;
    if (!Array.isArray(day.completed)) day.completed = [];
    if (route && !day.completed.includes(route)) day.completed.push(route);
    saveStore();
  }

  function markRoute(route) {
    const day = dayRecord(true);
    if (!Array.isArray(day.completed)) day.completed = [];
    if (!day.completed.includes(route)) {
      day.completed.push(route);
      saveStore();
    }
  }

  function calcStreak() {
    const cursor = new Date();
    if (!((store.days[dateKey(cursor)] || {}).minutes > 0)) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (count < 3650) {
      const day = store.days[dateKey(cursor)];
      if (!day || !(Number(day.minutes) > 0)) break;
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function accuracy() {
    const total = Number(store.totals.answered) || 0;
    return total ? Math.round((Number(store.totals.correct) || 0) / total * 100) : 0;
  }

  function setsForLevel(level = state.level) {
    return D.sets.filter(set => set.level === level);
  }

  function getSet(id) {
    return D.sets.find(set => set.id === id) || null;
  }

  function bestForSet(id) {
    const attempts = store.attempts.filter(item => item.id === id);
    if (!attempts.length) return null;
    return attempts.reduce((best, item) => {
      const ratio = item.total ? item.score / item.total : 0;
      return !best || ratio > best.ratio ? { item, ratio } : best;
    }, null).item;
  }

  function attemptedToday() {
    const key = dateKey();
    return new Set(store.attempts.filter(item => dateKey(new Date(item.date)) === key).map(item => item.id));
  }

  function recommendedSet() {
    const list = setsForLevel();
    const done = attemptedToday();
    return list.find(set => !done.has(set.id)) || list[0] || null;
  }

  function typeClass(type) {
    return { "短篇新闻": "orange", "长对话": "lime", "听力篇章": "blue", "讲座": "green" }[type] || "orange";
  }

  function typeLabel(set) {
    return set.type === "讲座" ? "讲座 / 讲话" : set.type;
  }

  function todayLabel() {
    const now = new Date();
    return `${WEEK_EN[now.getDay()]} · ${pad2(now.getDate())} ${MONTH_EN[now.getMonth()]} ${now.getFullYear()}`;
  }

  function shortDate(ts) {
    const date = new Date(ts);
    return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatSeconds(seconds) {
    return `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;
  }

  function scrollTop(smooth = true) {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: smooth && !reduce ? "smooth" : "auto" });
  }

  let toastTimer = null;
  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove("is-visible"), 3400);
  }

  /* ------------------------------------------------------------------ audio */
  const audio = {
    token: 0,
    mode: null,
    sentences: [],
    index: 0,
    playing: false,
    paused: false,
    finished: false,
    rate: 1,
    loop: false,
    timer: null,
    clip: null,
    transcriptIndex: null
  };
  let voices = [];

  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    try {
      voices = window.speechSynthesis.getVoices().filter(voice => /^en([-_]|$)/i.test(voice.lang || ""));
    } catch (error) {
      voices = [];
    }
    populateVoiceSelects();
  }

  function populateVoiceSelects() {
    const builtIn = Boolean(window.CET_AUDIO && Object.keys(window.CET_AUDIO).length);
    $$(".js-voice-select").forEach(select => {
      if (builtIn) {
        select.innerHTML = '<option value="">内置真题参考音色</option>';
        select.disabled = true;
        select.setAttribute("aria-label", "内置真题参考音色");
        return;
      }
      const previous = state.voiceURI || select.value || "";
      const options = ['<option value="">自动选择英语音色</option>'];
      voices.forEach(voice => {
        const name = voice.name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
        options.push(`<option value="${esc(voice.voiceURI)}">${esc(name || voice.name)} · ${esc(voice.lang)}</option>`);
      });
      if (!voices.length) {
        options[0] = '<option value="">系统英语语音（首次播放时加载）</option>';
      }
      select.innerHTML = options.join("");
      if (previous && Array.from(select.options).some(option => option.value === previous)) {
        select.value = previous;
      }
    });
  }

  function pickVoice() {
    if (state.voiceURI) {
      const saved = voices.find(voice => voice.voiceURI === state.voiceURI);
      if (saved) return saved;
    }
    if (!voices.length) return null;
    const priorities = [
      /aria/i, /jenny/i, /samantha/i, /ava/i, /google us english/i,
      /microsoft.*natural/i, /natural/i, /guy/i, /david/i
    ];
    for (const pattern of priorities) {
      const match = voices.find(voice => pattern.test(voice.name) && /^en[-_]US/i.test(voice.lang));
      if (match) return match;
    }
    return voices.find(voice => /^en[-_]US/i.test(voice.lang)) || voices.find(voice => /^en[-_]GB/i.test(voice.lang)) || voices[0];
  }

  function stopTimer() {
    if (audio.timer) {
      window.clearTimeout(audio.timer);
      audio.timer = null;
    }
  }

  function stopSpeech() {
    audio.token += 1;
    stopTimer();
    if (audio.clip) {
      try {
        audio.clip.pause();
        audio.clip.removeAttribute("src");
        audio.clip.load();
      } catch (error) {
        /* 忽略内置音频的释放异常 */
      }
      audio.clip = null;
    }
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch (error) {
      /* 忽略浏览器语音引擎的取消异常 */
    }
    audio.playing = false;
    audio.paused = false;
    audio.finished = false;
    audio.mode = null;
    audio.sentences = [];
    audio.transcriptIndex = null;
    updateAudioUI();
  }

  function speakIndex(index) {
    if (index >= audio.sentences.length) {
      if (audio.loop && audio.sentences.length) {
        audio.timer = window.setTimeout(() => {
          if (audio.token) speakIndex(0);
        }, 760);
        return;
      }
      audio.playing = false;
      audio.paused = false;
      audio.finished = true;
      updateAudioUI();
      return;
    }

    const token = audio.token;
    const sentence = audio.sentences[index];
    audio.index = index;
    audio.playing = true;
    audio.paused = false;
    audio.finished = false;
    updateAudioUI();

    const src = sentence && sentence.audioKey && window.CET_AUDIO
      ? window.CET_AUDIO[sentence.audioKey]
      : "";

    if (src) {
      try {
        if (audio.clip) {
          audio.clip.pause();
          audio.clip = null;
        }
        const clip = new Audio(src);
        audio.clip = clip;
        clip.preload = "auto";
        clip.playbackRate = audio.rate;
        if ("preservesPitch" in clip) clip.preservesPitch = true;
        clip.onended = () => {
          if (token !== audio.token) return;
          audio.clip = null;
          audio.timer = window.setTimeout(() => {
            if (token !== audio.token) return;
            speakIndex(index + 1);
          }, 260);
        };
        clip.onerror = () => {
          if (token !== audio.token) return;
          audio.clip = null;
          audio.playing = false;
          audio.paused = false;
          updateAudioUI();
          toast("内置音频加载失败，请刷新页面后重试。");
        };
        const playPromise = clip.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(error => {
            if (token !== audio.token) return;
            audio.playing = false;
            audio.paused = false;
            audio.clip = null;
            updateAudioUI();
            if (error && error.name === "NotAllowedError") {
              toast("浏览器拦截了自动播放，请再点一次播放键。");
            } else {
              toast("内置音频播放失败，请刷新页面后重试。");
            }
          });
        }
      } catch (error) {
        audio.clip = null;
        audio.playing = false;
        audio.paused = false;
        updateAudioUI();
        toast("内置音频播放失败，请刷新页面后重试。");
      }
      return;
    }

    if (!("speechSynthesis" in window)) {
      toast("当前浏览器不支持语音合成，请使用 Microsoft Edge 或 Chrome。");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(sentence.en);
    utterance.lang = "en-US";
    utterance.rate = audio.rate;
    utterance.pitch = sentence.sp === "M" ? 0.9 : sentence.sp === "W" ? 1.07 : 1;
    utterance.volume = 1;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      if (token !== audio.token) return;
      audio.timer = window.setTimeout(() => {
        if (token !== audio.token) return;
        speakIndex(index + 1);
      }, 260);
    };
    utterance.onerror = event => {
      if (token !== audio.token) return;
      if (event.error === "canceled" || event.error === "interrupted") return;
      audio.playing = false;
      audio.paused = false;
      updateAudioUI();
      if (event.error === "not-allowed") {
        toast("浏览器拦截了自动播放，请再点一次播放键。");
      } else if (event.error === "audio-busy") {
        toast("语音引擎正忙，请稍等一秒再试。");
      }
    };

    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      audio.playing = false;
      updateAudioUI();
      toast("语音播放失败，请刷新页面后重试。");
    }
  }

  function playSequence(sentences, options = {}) {
    if (!sentences || !sentences.length) return;
    stopSpeech();
    audio.token += 1;
    audio.mode = options.mode || "single";
    audio.sentences = sentences;
    audio.index = Math.min(Math.max(options.start || 0, 0), sentences.length - 1);
    audio.rate = options.rate || 1;
    audio.loop = Boolean(options.loop);
    audio.transcriptIndex = options.transcriptIndex == null ? null : options.transcriptIndex;
    speakIndex(audio.index);
  }

  function togglePause() {
    if (!audio.playing) return;

    if (audio.clip) {
      try {
        if (audio.paused) {
          const playPromise = audio.clip.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => toast("继续播放失败，请重新点播放。"));
          }
          audio.paused = false;
        } else {
          audio.clip.pause();
          audio.paused = true;
        }
        updateAudioUI();
      } catch (error) {
        toast("暂停失败，可以直接重新播放。");
      }
      return;
    }

    try {
      if (audio.paused) {
        window.speechSynthesis.resume();
        audio.paused = false;
      } else {
        window.speechSynthesis.pause();
        audio.paused = true;
      }
      updateAudioUI();
    } catch (error) {
      toast("暂停失败，可以直接重新播放。");
    }
  }

  function speakText(text, options = {}) {
    playSequence([{ en: text }], {
      mode: options.mode || "single",
      rate: options.rate || 1,
      loop: false
    });
  }

  function updateAudioUI() {
    const playing = audio.playing && !audio.paused;
    $$("[data-role='play-toggle']").forEach(button => {
      const icon = $("use", button);
      if (icon) icon.setAttribute("href", playing ? "#i-pause" : "#i-play");
      button.setAttribute("aria-label", playing ? "暂停" : "播放");
    });

    const status = !audio.playing
      ? audio.finished ? "播放完毕 · 可重听" : "准备播放"
      : audio.paused
        ? `已暂停 · 第 ${audio.index + 1} / ${audio.sentences.length} 句`
        : `播放中 · 第 ${audio.index + 1} / ${audio.sentences.length} 句`;
    $$("[data-role='audio-status']").forEach(element => {
      if (audio.sentences.length) element.textContent = status;
    });

    $$("[data-role='prev-sentence']").forEach(button => {
      button.disabled = audio.index <= 0;
    });
    $$("[data-role='next-sentence']").forEach(button => {
      button.disabled = audio.index >= audio.sentences.length - 1;
    });

    const progress = audio.sentences.length
      ? (!audio.playing && !audio.finished ? 0 : (audio.index + (audio.paused || audio.finished ? 0 : 0.55)) / audio.sentences.length)
      : 0;
    $$("[data-role='viz']").forEach(viz => {
      const bars = $$("span", viz);
      bars.forEach((bar, index) => {
        const position = (index + 1) / bars.length;
        bar.classList.toggle("is-on", position <= progress + 0.001);
        bar.classList.toggle("is-past", position < progress - 1.2 / bars.length);
      });
      viz.classList.toggle("is-playing", playing);
    });

    $$("[data-role='rate']").forEach(button => {
      button.classList.toggle("is-on", Number(button.dataset.rate) === audio.rate);
    });

    $$(".transcript-row").forEach(row => {
      const index = Number(row.dataset.sentence);
      row.classList.toggle(
        "is-speaking",
        (audio.mode === "practice" || audio.mode === "sentence") &&
        audio.playing &&
        index === (audio.mode === "sentence" ? audio.transcriptIndex : audio.index)
      );
    });
  }

  /* ------------------------------------------------------------- render home */
  function renderWaveBars(count = 36) {
    return Array.from({ length: count }, (_, index) => {
      const height = 16 + Math.round(Math.abs(Math.sin((index + 1) * 0.82)) * 66);
      return `<span style="--i:${index};height:${height}%"></span>`;
    }).join("");
  }

  function renderSetCard(set, index) {
    const best = bestForSet(set.id);
    const meta = [
      `${set.questions.length} 题`,
      `${set.vocab.length} 个词`,
      best ? `最佳 ${best.score}/${best.total}` : ""
    ].filter(Boolean).map((item, i) => `${i ? "<i></i>" : ""}<span>${esc(item)}</span>`).join("");
    return `
      <button class="set-card" style="--accent:var(--${set.accent || "orange"})" data-action="open-set" data-id="${esc(set.id)}" aria-label="开始 ${esc(set.titleZh)}">
        <div class="set-card-top">
          <span class="tag ${typeClass(set.type)}">${esc(typeLabel(set))}</span>
          <span class="set-card-index">SET ${pad2(index + 1)}</span>
        </div>
        <h3>${esc(set.title)}</h3>
        <p class="zh">${esc(set.titleZh)}</p>
        <div class="set-card-bottom">
          <div class="set-meta">${meta}</div>
          <span class="set-open"><svg><use href="#i-arrow"/></svg></span>
        </div>
      </button>`;
  }

  function renderRouteRow(number, key, title, en, description, minutes, done) {
    return `
      <button class="route-row ${done ? "done" : ""}" data-action="start-route" data-route="${key}">
        <span class="route-num"><span>${pad2(number)}</span><svg><use href="#i-check"/></svg></span>
        <span class="route-copy">
          <strong>${esc(title)} <em>${esc(en)}</em></strong>
          <p>${esc(description)}</p>
        </span>
        <span class="route-side">
          <small>${done ? "已完成" : `约 ${minutes} min`}</small>
          <span class="route-arrow"><svg><use href="#i-arrow"/></svg></span>
        </span>
      </button>`;
  }

  function examInfo() {
    if (state.level === 6) {
      return {
        sections: [
          ["长对话", 8, 8],
          ["听力篇章", 7, 7],
          ["讲座 / 讲话", 20, 10]
        ]
      };
    }
    return {
      sections: [
        ["短篇新闻", 7, 7],
        ["长对话", 8, 8],
        ["听力篇章", 20, 10]
      ]
    };
  }

  function renderHome() {
    const today = dayRecord();
    const completed = new Set(today.completed || []);
    const sets = setsForLevel();
    const recommended = recommendedSet();
    const exam = examInfo();
    const routeCount = completed.size > 3 ? 3 : completed.size;
    const totalMinutes = Object.values(store.days).reduce((sum, day) => sum + (Number(day.minutes) || 0), 0);
    return `
      <div class="view">
        <div class="hero">
          <div class="hero-copy">
            <span class="eyebrow">${todayLabel()} · CET-${state.level} LISTENING</span>
            <h1>把耳朵<br>练成<span class="accent">第二本能</span>。</h1>
            <p class="hero-lede">每天 15 分钟，一组仿真题、三句精听、一次开口。让耳朵先于眼睛，认出英语的节奏。</p>
            <div class="hero-actions">
              <button class="btn btn-dark" data-action="start-daily">
                开始今日 15 分钟 <svg><use href="#i-arrow"/></svg>
              </button>
              <button class="btn btn-ghost" data-view="intensive">
                先精听一句
              </button>
            </div>
            <div class="hero-note">
              <svg><use href="#i-headphones"/></svg>
              内置真题参考音色 · 可暂停 / 变速 / 重听 · 建议佩戴耳机
            </div>
          </div>

          <div class="listen-card" aria-hidden="true">
            <div class="listen-top">
              <span>NOW SPINNING</span>
              <span class="live">READY</span>
            </div>
            <div class="vinyl-wrap">
              <div class="vinyl">
                <div class="vinyl-label"><b>${state.level}</b><span>CET · LISTEN</span></div>
                <span class="vinyl-hole"></span>
              </div>
              <div class="sticker">耳朵<br>开机<small>15 MIN / DAY</small></div>
            </div>
            <div class="listen-wave">${renderWaveBars(38)}</div>
            <div class="listen-meta">
              <div>
                <strong>Daily Listening / ${pad2(routeCount + 1)}</strong>
                <span>今日路线 · ${routeCount} / 3 完成</span>
              </div>
              <span class="listen-play"><svg><use href="#i-play"/></svg></span>
            </div>
          </div>
        </div>

        <div class="stat-ribbon">
          <div class="stat-cell">
            <span class="stat-trend">TODAY</span>
            <b>${Number(today.minutes) || 0}<small>min</small></b>
            <span>今日有效练习</span>
          </div>
          <div class="stat-cell">
            <b>${store.totals.answered || 0}<small>题</small></b>
            <span>累计作答</span>
          </div>
          <div class="stat-cell">
            <b>${accuracy()}<small>%</small></b>
            <span>累计正确率</span>
          </div>
          <div class="stat-cell">
            <b>${calcStreak()}<small>天</small></b>
            <span>连续练习</span>
          </div>
        </div>

        <div class="section-head">
          <div>
            <span class="section-index">01 / DAILY ROUTINE</span>
            <h2>今天，练这三件事。</h2>
            <p>不必贪多。听懂一句，比模糊地听完十句更有用。</p>
          </div>
          <span class="tag ${routeCount === 3 ? "green" : ""}">${routeCount === 3 ? "今日已完成" : `${totalMinutes} min 累计`}</span>
        </div>

        <div class="daily-grid">
          <div class="route-card">
            ${renderRouteRow(1, "practice", "仿真套题", "FULL SET", "从仿真题库里挑一组，先听两遍，再凭第一反应作答。", 8, completed.has("practice"))}
            ${renderRouteRow(2, "intensive", "逐句精听", "DICTATION", "一次只听一句。听三遍再落笔，抓住连读、弱读和数字。", 5, completed.has("intensive"))}
            ${renderRouteRow(3, "shadow", "跟读录音", "SHADOWING", "录下自己的声音，和原句比一比重音、停顿和语调。", 2, completed.has("shadow"))}
          </div>

          <aside class="exam-card">
            <div class="exam-top">
              <span>CET-${state.level} · 听力结构</span>
              <span class="tag lime">25 题</span>
            </div>
            <div class="exam-big"><b>248.5</b><span>分 / 满分</span></div>
            <p class="exam-sub">听力占全卷 35% · 约 30 分钟</p>
            <div class="exam-bars">
              ${exam.sections.map(([name, percent, count]) => `
                <div>
                  <div class="exam-bar-label"><span>${name} · ${count} 题</span><b>${percent}%</b></div>
                  <div class="exam-track"><i style="width:${Math.round(percent / 35 * 100)}%"></i></div>
                </div>`).join("")}
            </div>
            <p class="exam-note">每题约 9.94 分。先保正确率，再练反应速度。</p>
          </aside>
        </div>

        <div class="section-head">
          <div>
            <span class="section-index">02 / PRACTICE LIBRARY</span>
            <h2>从一组题开始。</h2>
            <p>仿真题按 CET-${state.level} 的题型和语速编排，不是官方真题。</p>
          </div>
          <button class="text-link" data-view="library">全部 ${sets.length} 组 <svg><use href="#i-arrow"/></svg></button>
        </div>
        <div class="set-grid">
          ${sets.slice(0, 3).map((set, index) => renderSetCard(set, index)).join("")}
        </div>

        <section class="quote-strip">
          <div class="quote-copy">
            <span class="eyebrow">ONE LINE WORTH KEEPING</span>
            <blockquote>“${esc(DAILY_QUOTE.en.replace("the freedom", "the freedom"))}”</blockquote>
            <span class="quote-source">${esc(DAILY_QUOTE.source)} · 点右侧听原句</span>
          </div>
          <button class="listen-play" data-action="play-quote" aria-label="播放今日一句">
            <svg><use href="#i-play"/></svg>
          </button>
        </section>
      </div>`;
  }

  /* ---------------------------------------------------------- render library */
  function renderLibrary() {
    const all = setsForLevel();
    const types = ["全部", ...Array.from(new Set(all.map(set => set.type)))];
    const filter = types.includes(state.libraryFilter) ? state.libraryFilter : "全部";
    const filtered = filter === "全部" ? all : all.filter(set => set.type === filter);
    const questionCount = all.reduce((sum, set) => sum + set.questions.length, 0);
    const vocabCount = all.reduce((sum, set) => sum + set.vocab.length, 0);
    return `
      <div class="view">
        <div class="page-intro">
          <div>
            <span class="eyebrow">SIMULATED EXAM · CET-${state.level}</span>
            <h1 class="page-title">把真题的节奏，<br>先<em>练进耳朵</em>。</h1>
            <p class="lede">按短篇新闻、长对话、篇章和讲座分组。先盲听作答，再逐句核对；每一组都能反复重听。</p>
          </div>
          <div class="intro-stat">
            <div><b>${all.length}</b><span>组仿真题</span></div>
            <div><b>${questionCount}</b><span>道听力题</span></div>
            <div><b>${vocabCount}</b><span>个核心词</span></div>
          </div>
        </div>

        <div class="library-toolbar">
          <div class="filter-tabs" role="tablist" aria-label="按题型筛选">
            ${types.map(type => `<button class="${filter === type ? "is-on" : ""}" data-action="filter-type" data-type="${esc(type)}" role="tab" aria-selected="${filter === type}">${esc(typeLabel({ type }))}${type === "全部" ? ` · ${all.length}` : ""}</button>`).join("")}
          </div>
          <span class="toolbar-note"><b>仿真练习</b> · 5 题/组 · 非官方真题 · 内置参考音色</span>
        </div>

        ${filtered.length ? `<div class="set-grid two">${filtered.map((set, index) => renderSetCard(set, all.indexOf(set))).join("")}</div>` : '<div class="empty-state">这个筛选下暂时没有题目。</div>'}

        <div class="quote-strip">
          <div class="quote-copy">
            <span class="eyebrow">HOW TO USE THIS LIBRARY</span>
            <blockquote style="font-size:clamp(20px,2.2vw,28px)">第一遍听结构，第二遍抓细节，第三遍才看原文。<br><em>不要用眼睛替耳朵偷答案。</em></blockquote>
            <span class="quote-source">建议每组题练 2–3 次，间隔一天再回来重听</span>
          </div>
          <button class="btn btn-ghost" data-action="open-help">查看练习方法 <svg><use href="#i-arrow"/></svg></button>
        </div>
      </div>`;
  }

  /* --------------------------------------------------------- render practice */
  function renderQuestionCard(question, index, submitted, answers) {
    const selected = answers[index];
    const isCorrect = submitted && selected === question.answer;
    const isWrong = submitted && selected != null && selected !== question.answer;
    return `
      <article class="question-card ${isCorrect ? "is-correct" : isWrong ? "is-wrong" : ""}" data-question="${index}">
        <div class="q-head">
          <span class="q-num">${pad2(index + 1)}</span>
          <h2 class="q-text">${esc(question.q)}</h2>
        </div>
        <div class="options" role="group" aria-label="第 ${index + 1} 题选项">
          ${question.options.map((option, optionIndex) => {
            const selectedOption = selected === optionIndex;
            const right = submitted && optionIndex === question.answer;
            const wrong = submitted && selectedOption && !right;
            const resultLabel = right ? "正确答案" : wrong ? "你的选择" : "";
            return `<button
              class="option ${selectedOption ? "is-selected" : ""} ${right ? "is-correct" : ""} ${wrong ? "is-wrong" : ""}"
              data-action="select-answer"
              data-q="${index}"
              data-opt="${optionIndex}"
              aria-pressed="${selectedOption}"
              ${submitted ? "disabled" : ""}>
              <span class="option-key">${String.fromCharCode(65 + optionIndex)}</span>
              <span>${esc(option)}</span>
              ${resultLabel ? `<span class="option-result">${resultLabel}</span>` : ""}
            </button>`;
          }).join("")}
        </div>
        ${submitted ? `<div class="explain"><b>解析</b><span>${esc(question.explain)}</span></div>` : ""}
      </article>`;
  }

  function renderTranscript(set) {
    return `
      <div class="transcript-card">
        ${set.sentences.map((sentence, index) => `
          <button class="transcript-row" data-action="play-transcript" data-sentence="${index}">
            <span class="t-play"><svg><use href="#i-play"/></svg></span>
            <span class="t-en">${sentence.sp ? `<span class="sp">${esc(sentence.sp)}</span>` : ""}${esc(sentence.en)}</span>
            <span class="t-zh">${esc(sentence.zh)}</span>
          </button>`).join("")}
        <div class="transcript-foot">
          <svg style="width:12px;height:12px"><use href="#i-volume"/></svg>
          点击任意句子可单独重听。中文译文只用于核对理解，不建议第一遍就看。
        </div>
      </div>`;
  }

  function practiceMessage(score, total) {
    const ratio = score / total;
    if (ratio === 1) return ["全部答对。试着不看原文，再完整听一遍。", "耳朵已经跟上了。"];
    if (ratio >= 0.66) return ["已经抓住大部分信息。回看错题，找到漏听的那一句。", "方向是对的。"];
    if (ratio >= 0.34) return ["先别急。看一遍原文，再关掉译文重听。", "慢一点，会更清楚。"];
    return ["先把原文读通，再回来听第二遍。听不懂不是失败，是定位。", "从一句开始。"];
  }

  function renderPractice() {
    const set = state.practice ? getSet(state.practice.setId) : null;
    if (!set) return renderLibrary();
    const p = state.practice;
    const allIndex = setsForLevel(set.level).findIndex(item => item.id === set.id);
    const answered = Object.keys(p.answers).length;
    const total = set.questions.length;
    const resultCopy = p.submitted ? practiceMessage(p.score, total) : null;
    return `
      <div class="view practice-wrap">
        <button class="back-link" data-view="library"><svg><use href="#i-back"/></svg> 返回仿真题库</button>
        <div class="practice-head">
          <div>
            <span class="eyebrow">SET ${pad2(allIndex + 1)} · ${esc(typeLabel(set))} · CET-${set.level}</span>
            <h1>${esc(set.title)}</h1>
            <div class="title-zh">${esc(set.titleZh)} · ${esc(set.summary)}</div>
          </div>
          <div class="practice-head-side">
            <span class="pill"><strong>${total}</strong> 题</span>
            <span class="pill"><strong>${set.sentences.length}</strong> 句</span>
            <span class="pill"><strong>${esc(set.difficulty)}</strong></span>
          </div>
        </div>

        <div class="audio-console">
          <div class="console-top">
            <span>SIMULATED AUDIO · SET ${pad2(allIndex + 1)}</span>
            <span class="live">AUDIO READY</span>
          </div>
          <div class="console-body">
            <button class="play-big" data-action="toggle-practice-audio" data-role="play-toggle" aria-label="播放或暂停">
              <svg data-role="play-icon"><use href="#i-play"/></svg>
            </button>
            <div class="viz-wrap">
              <div class="viz" data-role="viz">${renderWaveBars(56)}</div>
              <div class="viz-caption">
                <span data-role="audio-status" aria-live="polite">准备播放</span>
                <b>${set.sentences.length} 句 · 建议听 2 遍</b>
              </div>
            </div>
            <div class="console-tools">
              <div class="rate-switch" aria-label="播放速度">
                ${[0.75, 1, 1.25].map(rate => `<button class="${rate === 1 ? "is-on" : ""}" data-action="set-rate" data-role="rate" data-rate="${rate}">${rate}×</button>`).join("")}
              </div>
              <button class="round-tool" data-action="prev-sentence" data-role="prev-sentence" aria-label="上一句" disabled><svg><use href="#i-back"/></svg></button>
              <button class="round-tool" data-action="next-sentence" data-role="next-sentence" aria-label="下一句"><svg><use href="#i-next"/></svg></button>
            </div>
          </div>
          <div class="console-bottom">
            <span class="console-hint"><svg><use href="#i-headphones"/></svg> 先完整听两遍，再逐题作答；交卷前不会显示原文。</span>
            <button class="replay-sentence" data-action="replay-sentence">↺ 重听本句</button>
          </div>
        </div>

        <div class="practice-instruction">
          <svg><use href="#i-headphones-small"/></svg>
          选出最符合音频内容的选项。四个选项都要读完，别只听关键词。
        </div>

        ${set.questions.map((question, index) => renderQuestionCard(question, index, p.submitted, p.answers)).join("")}

        ${!p.submitted ? `
          <div class="submit-bar">
            <div class="submit-progress">
              <span id="answeredCount"><b>${answered}</b> / ${total} 已作答</span>
              <div class="mini-track"><i id="answerProgress" style="width:${total ? answered / total * 100 : 0}%"></i></div>
            </div>
            <div class="submit-actions">
              <button class="btn btn-ghost" data-view="library">退出</button>
              <button class="btn btn-dark" id="submitPractice" data-action="submit-practice" ${answered < total ? "disabled" : ""}>交卷 · 看解析 <svg><use href="#i-arrow"/></svg></button>
            </div>
          </div>` : `
          <div class="result-banner" role="status">
            <div class="result-score">${p.score}<small>/${total}</small></div>
            <div class="result-copy">
              <strong>${esc(resultCopy[0])}</strong>
              <p>${esc(resultCopy[1])} 原文与解析已展开，错题建议逐句重听。</p>
            </div>
            <div class="result-stamp">KEEP<br>LISTENING</div>
          </div>`}

        ${p.submitted ? `
          <section class="review-section">
            <div class="review-head">
              <h2>回看原文</h2>
              <span class="tag green">已解锁</span>
            </div>
            ${renderTranscript(set)}
            <div class="vocab-card">
              <h3>本组核心词汇</h3>
              <div class="vocab-list">
                ${set.vocab.map(word => `<span class="vocab-item"><b>${esc(word.word)}</b><i>${esc(word.pos)}</i><span>${esc(word.cn)}</span></span>`).join("")}
              </div>
            </div>
          </section>

          <div class="practice-foot">
            <p>建议：先不看中文，再听一遍原文，看能否只靠耳朵跟上。题目为仿真练习，语音为内置参考音色。</p>
            <div class="submit-actions">
              <button class="btn btn-ghost" data-view="library">返回题库</button>
              <button class="btn btn-dark" data-action="next-set">下一组 <svg><use href="#i-arrow"/></svg></button>
            </div>
          </div>` : `
          <div class="practice-foot">
            <p>交卷后才会展开原文、译文和词汇。所有作答与进度只保存在当前浏览器。</p>
            <span class="tag">${esc(set.tip)}</span>
          </div>`}
      </div>`;
  }

  /* -------------------------------------------------------- render intensive */
  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/[^a-z0-9'\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
  }

  function diffWords(userText, targetText) {
    const user = tokenize(userText);
    const target = tokenize(targetText);
    const rows = user.length + 1;
    const cols = target.length + 1;
    const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        dp[i][j] = user[i - 1] === target[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    const operations = [];
    let i = user.length;
    let j = target.length;
    let correct = 0;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && user[i - 1] === target[j - 1]) {
        operations.push({ type: "same", word: target[j - 1] });
        correct += 1;
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        operations.push({ type: "miss", word: target[j - 1] });
        j -= 1;
      } else {
        operations.push({ type: "extra", word: user[i - 1] });
        i -= 1;
      }
    }
    operations.reverse();
    const total = Math.max(target.length, user.length);
    return {
      operations,
      correct,
      total,
      percent: total ? Math.round(correct / total * 100) : 0
    };
  }

  function renderTargetDiff(result) {
    const words = result.operations.filter(item => item.type !== "extra");
    if (!words.length) return "（原文为空）";
    return words.map(item => `<span class="${item.type === "same" ? "w-good" : "w-miss"}">${esc(item.word)}</span>`).join(" ");
  }

  function renderUserDiff(result) {
    const words = result.operations.filter(item => item.type !== "miss");
    if (!words.length) return "（没有写下内容）";
    return words.map(item => `<span class="${item.type === "same" ? "w-good" : "w-extra"}">${esc(item.word)}</span>`).join(" ");
  }

  function renderCheckResult(result, text) {
    const verdict = result.percent >= 95
      ? "几乎全对，把这个节奏记住。"
      : result.percent >= 75
        ? "抓住了大部分，再补上红色词。"
        : result.percent >= 45
          ? "骨架有了，细节还需要再听。"
          : "这一次先看清原文，再重听两遍。";
    return `
      <div class="check-result">
        <div class="check-result-head">
          <strong>${verdict}</strong>
          <span>${result.correct} / ${result.total} 词 · <b class="accuracy">${result.percent}%</b></span>
        </div>
        <div class="diff-block">
          <span class="diff-label">你的听写</span>
          <div class="diff-text">${renderUserDiff(result)}</div>
        </div>
        <div class="diff-block">
          <span class="diff-label">原文对照 · 波浪线是漏掉的词</span>
          <div class="diff-text">${renderTargetDiff(result)}</div>
        </div>
        <div class="answer-reveal"><b>译文</b>${esc(text)}</div>
      </div>`;
  }

  function renderIntensive() {
    const item = D.intensive[state.intensive.index] || D.intensive[0];
    const day = dayRecord();
    const done = new Set(day.dictations || []);
    const doneCount = D.intensive.filter(entry => done.has(entry.id)).length;
    const current = state.intensive;
    return `
      <div class="view intensive-wrap">
        <div class="page-intro">
          <div>
            <span class="eyebrow">INTENSIVE LISTENING · DICTATION</span>
            <h1 class="page-title">把一句话，<br><em>听到底。</em></h1>
            <p class="lede">一次只放一句。先听 2–3 遍，再默写整句；对照时别只看错词，也听听自己漏掉了哪一段节奏。</p>
          </div>
          <div class="intro-stat">
            <div><b>${D.intensive.length}</b><span>句精选语料</span></div>
            <div><b>${doneCount}</b><span>今日完成</span></div>
          </div>
        </div>

        <div class="sentence-progress" aria-label="精听句子进度">
          ${D.intensive.map((entry, index) => `
            <button class="${done.has(entry.id) ? "is-done" : ""} ${index === current.index ? "is-current" : ""}"
              data-action="go-intensive" data-index="${index}" aria-label="第 ${index + 1} 句" title="第 ${index + 1} 句"></button>`).join("")}
        </div>

        <article class="intensive-card">
          <div class="sentence-meta">
            <div class="sentence-meta-left">
              <b>SENTENCE ${pad2(current.index + 1)} / ${pad2(D.intensive.length)}</b>
              <span class="tag ${current.checked ? "green" : "orange"}">CET-${item.level}</span>
              <span>${esc(item.focus)}</span>
            </div>
            <span>TODAY ${pad2(doneCount)} / ${pad2(D.intensive.length)}</span>
          </div>

          <div class="sentence-stage">
            ${current.checked
              ? `<p class="sentence-big">${esc(item.text)}</p>
                 <p class="sentence-zh">${esc(item.zh)}</p>
                 <div class="sentence-tip"><b>${esc(item.focus)}</b><span>${esc(item.tip)}</span></div>`
              : `<p class="sentence-big" style="color:#aaa496">Listen. Then write every word.</p>
                 <p class="sentence-zh">先听 2–3 遍，再从第一个词开始写。标点、大小写不计分。</p>
                 <div class="sentence-tip"><b>提示</b><span>先抓句子骨架：谁 + 做了什么 + 为什么。不确定的词先留空，别停下来。</span></div>`}
          </div>

          <div class="sentence-controls">
            <div class="sentence-play-group">
              <button class="play-medium" data-action="play-intensive" data-role="play-toggle" aria-label="播放本句">
                <svg data-role="play-icon"><use href="#i-play"/></svg>
              </button>
              <button class="slow-toggle ${current.slow ? "is-on" : ""}" data-action="toggle-slow">0.75× 慢速</button>
              <button class="loop-toggle ${current.loop ? "is-on" : ""}" data-action="toggle-loop">
                <svg><use href="#i-repeat"/></svg> 循环
              </button>
            </div>
            <span class="tag">${esc(item.focus)} · 逐句输入</span>
          </div>

          <label class="dictation-label" for="dictationInput">
            <span>写下你听到的整句</span>
            <span>${current.checked ? "已核对" : "标点与大小写不计分"}</span>
          </label>
          <textarea class="dictation-input" id="dictationInput" placeholder="Type what you hear..." ${current.checked ? "readonly" : ""}>${esc(current.input)}</textarea>

          <div class="dictation-actions">
            <div class="left">
              ${!current.checked ? '<span class="kbd-note"><span class="kbd">Ctrl</span> + <span class="kbd">Enter</span> 检查</span>' : '<span class="kbd-note">红色波浪线 = 漏掉的词；灰色删除线 = 多写 / 听错的词</span>'}
            </div>
            <div class="left">
              ${!current.checked ? `
                <button class="btn btn-ghost" data-action="reveal-answer">直接看答案</button>
                <button class="btn btn-dark" id="checkDictation" data-action="check-dictation" ${current.input.trim() ? "" : "disabled"}>检查听写 <svg><use href="#i-check"/></svg></button>
              ` : `
                <button class="btn btn-ghost" data-action="play-intensive">再听一遍</button>
                <button class="btn btn-dark" data-action="next-intensive">${current.index === D.intensive.length - 1 ? "回到第一句" : "下一句"} <svg><use href="#i-arrow"/></svg></button>
              `}
            </div>
          </div>

          ${current.checked && current.result ? renderCheckResult(current.result, item.zh) : ""}
        </article>

        <div class="intensive-side">
          <div><span>本句焦点</span><b>${esc(item.focus)}</b><p>听清一个特征，比模糊地重复十遍更有效。</p></div>
          <div><span>建议步骤</span><b>听 → 写 → 对照</b><p>写不出来时，先回听半句，不要立刻看答案。</p></div>
          <div><span>今日进度</span><b>${doneCount} / ${D.intensive.length} 句</b><p>每完成一句，今日专注加 1 分钟。</p></div>
        </div>
      </div>`;
  }

  /* ----------------------------------------------------------- render shadow */
  function canRecord() {
    if (window.isSecureContext === false) return false;
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function renderShadow() {
    const item = D.shadow[state.shadow.index] || D.shadow[0];
    const current = state.shadow;
    const supports = canRecord();
    return `
      <div class="view shadow-wrap">
        <div class="page-intro">
          <div>
            <span class="eyebrow">SHADOWING · SPEAK IT OUT</span>
            <h1 class="page-title">让嘴巴，<br>跟上<em>耳朵</em>。</h1>
            <p class="lede">跟读不是背句子，是复制节奏。先听原句，再录下自己；对比重音、停顿和句尾语调，然后重录一次。</p>
          </div>
          <div class="intro-stat">
            <div><b>${D.shadow.length}</b><span>句跟读素材</span></div>
            <div><b>30<small style="font-size:12px">s</small></b><span>单次录音上限</span></div>
          </div>
        </div>

        <div class="shadow-chooser" aria-label="选择跟读句子">
          ${D.shadow.map((entry, index) => `
            <button class="shadow-chip ${index === current.index ? "is-on" : ""}" data-action="select-shadow" data-index="${index}">
              <b>${pad2(index + 1)}</b> CET-${entry.level}
            </button>`).join("")}
        </div>

        <section class="shadow-card">
          <div class="shadow-meta">
            <span>SHADOWING ${pad2(current.index + 1)} / ${pad2(D.shadow.length)}</span>
            <span>CET-${item.level} · 跟读</span>
          </div>
          <blockquote class="shadow-quote">${esc(item.text)}</blockquote>
          <div class="shadow-zh">${esc(item.zh)}</div>
          <div class="shadow-tip"><b>重音提示</b><span>${esc(item.tip)}</span></div>
        </section>

        <div class="shadow-controls">
          <div class="shadow-listen">
            <button class="play-medium" data-action="play-shadow" data-role="play-toggle" aria-label="播放原句"><svg data-role="play-icon"><use href="#i-play"/></svg></button>
            <div><strong>先听原句</strong><small>留意重音落在哪几个词上</small></div>
          </div>
          <div class="record-zone">
            <button class="mic-btn ${current.isRecording ? "is-recording" : ""}" data-action="record-shadow" aria-label="${current.isRecording ? "停止录音" : "开始录音"}">
              <svg><use href="#i-mic"/></svg>
            </button>
            <div class="record-copy">
              <strong>${current.isRecording ? "正在录音…" : "录下你的版本"}</strong>
              <small>${current.isRecording ? "再次点击停止 · 最长 30 秒" : "麦克风只在本机使用，不会上传"}</small>
            </div>
            <span class="record-timer" id="recordTimer" style="${current.isRecording ? "" : "display:none"}">00:00</span>
          </div>
        </div>

        ${current.blobUrl ? `
          <div class="record-comparison">
            <h3>你的录音 · 和原句对比着听</h3>
            <audio src="${esc(current.blobUrl)}" controls preload="metadata"></audio>
            <div class="record-hint"><svg><use href="#i-headphones"/></svg> 先听自己的，再点上面的原句；重点听重音和停顿，不必追求口音。</div>
          </div>` : ""}

        <div class="self-check">
          <h3>这一次，检查三件事。</h3>
          <p>不用打分。自己听得出差别，就是进步。</p>
          <div class="check-list">
            ${[
              "重音落在实词上了吗？",
              "该连读的地方连起来了吗？",
              "句尾的语调像原句吗？"
            ].map((label, index) => `
              <button class="self-check-btn ${current.checks[index] ? "is-on" : ""}" data-action="toggle-check" data-check="${index}">
                <span class="box"><svg><use href="#i-check"/></svg></span>
                <span>${label}</span>
              </button>`).join("")}
          </div>
        </div>

        ${!supports ? `
          <div class="record-notice"><b>当前环境无法启用录音。</b>${window.isSecureContext === false ? " 手机通过局域网 HTTP 打开时，浏览器会限制麦克风；听力播放不受影响。需要跟读录音时，请在电脑上用 http://127.0.0.1:8765/ 打开。" : " 建议使用 Microsoft Edge 或 Chrome；如果是直接打开的本地文件，麦克风可能被浏览器拦截，请关闭页面后双击文件夹里的「启动听力室.bat」再试。"}</div>
        ` : location.protocol === "file:" ? `
          <div class="record-notice"><b>小提示：</b> 当前是直接打开本地文件。如果点击录音没有反应，请关闭页面，双击文件夹里的「启动听力室.bat」，用本地地址重新打开。</div>
        ` : ""}

        <div class="shadow-privacy">
          <svg><use href="#i-volume"/></svg>
          录音仅保存在当前页面内存中，刷新即清除，不上传、不评分。
        </div>
      </div>`;
  }

  /* ----------------------------------------------------------- render report */
  function weekData() {
    const days = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = dateKey(date);
      days.push({
        key,
        label: WEEK_CN[date.getDay()],
        date,
        minutes: Number((store.days[key] || {}).minutes) || 0,
        today: offset === 0
      });
    }
    return days;
  }

  function renderReport() {
    const total = Number(store.totals.answered) || 0;
    const correct = Number(store.totals.correct) || 0;
    const acc = accuracy();
    const today = dayRecord();
    const week = weekData();
    const weekTotal = week.reduce((sum, day) => sum + day.minutes, 0);
    const maxMinutes = Math.max(20, ...week.map(day => day.minutes));
    const recent = store.attempts.slice(0, 6);
    const levels = [4, 6].map(level => {
      const items = store.attempts.filter(item => item.level === level);
      const answeredCount = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
      const correctCount = items.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
      return {
        level,
        attempts: items.length,
        answered: answeredCount,
        percent: answeredCount ? Math.round(correctCount / answeredCount * 100) : null
      };
    });
    return `
      <div class="view">
        <div class="page-intro">
          <div>
            <span class="eyebrow">YOUR LISTENING LOG · LOCAL ONLY</span>
            <h1 class="page-title">声音会留下，<br><em>进步也会。</em></h1>
            <p class="lede">这里只记录你在这台设备上的练习。数据留在浏览器里，不会上传，也不需要账号。</p>
          </div>
          <div class="intro-stat">
            <div><b>${calcStreak()}</b><span>连续练习天数</span></div>
            <div><b>${store.totals.sessions || 0}</b><span>完成套数</span></div>
          </div>
        </div>

        <div class="report-hero">
          <section class="report-score-card">
            <span class="eyebrow">OVERALL ACCURACY</span>
            <div class="big-accuracy">${acc}<span>%</span></div>
            <p>${total ? `累计答对 ${correct} 题，共作答 ${total} 题。` : "还没有答题记录。先完成一组仿真题，这里会开始生长。"}</p>
            <div class="score-foot">
              <div><b>${total}</b><span>累计题数</span></div>
              <div><b>${store.totals.sessions || 0}</b><span>练习套数</span></div>
              <div><b>${Object.keys(store.days).filter(key => (store.days[key].minutes || 0) > 0).length}</b><span>有效练习天</span></div>
            </div>
          </section>
          <div class="report-side-stack">
            <div class="report-mini">
              <div class="report-mini-top"><span>今日专注</span><b>${today.minutes >= 15 ? "达标" : "继续"}</b></div>
              <strong>${today.minutes || 0} <small style="font-family:var(--sans);font-size:9px;letter-spacing:0">min</small></strong>
              <p>今日目标 15 分钟</p>
            </div>
            <div class="report-mini">
              <div class="report-mini-top"><span>最近 7 天</span><b>${weekTotal >= 90 ? "很稳" : "积累中"}</b></div>
              <strong>${weekTotal} <small style="font-family:var(--sans);font-size:9px;letter-spacing:0">min</small></strong>
              <p>有效练习总时长</p>
            </div>
            <div class="report-mini">
              <div class="report-mini-top"><span>连续练习</span><b>STREAK</b></div>
              <strong>${calcStreak()} <small style="font-family:var(--sans);font-size:9px;letter-spacing:0">天</small></strong>
              <p>哪怕只练一句，也算今天来过。</p>
            </div>
          </div>
        </div>

        <div class="report-grid">
          <div>
            <section class="report-panel">
              <div class="report-panel-head">
                <div><h2>这一周，耳朵醒着。</h2><p>柱高代表当天的有效练习分钟数。</p></div>
                <span class="tag">${weekTotal} min</span>
              </div>
              <div class="week-chart">
                ${week.map(day => {
                  const height = day.minutes ? Math.max(7, Math.round(day.minutes / maxMinutes * 100)) : 2;
                  return `<div class="day-col ${day.minutes ? "has-data" : ""} ${day.today ? "is-today" : ""}" title="${day.key} · ${day.minutes} 分钟">
                    <span class="bar-value">${day.minutes || ""}</span>
                    <span class="day-bar" style="height:${height}%"></span>
                    <span class="day-name">${day.today ? "今" : day.label}</span>
                  </div>`;
                }).join("")}
              </div>
              <div class="week-legend"><span>7 天前</span><span>今天</span></div>
            </section>

            <section class="report-panel">
              <div class="report-panel-head">
                <div><h2>最近练过</h2><p>每次交卷都会留下一条记录。</p></div>
                <button class="text-link" data-view="library">再练一组 <svg><use href="#i-arrow"/></svg></button>
              </div>
              <div class="attempt-list">
                ${recent.length ? recent.map(item => {
                  const ratio = item.total ? item.score / item.total : 0;
                  const scoreClass = ratio >= 0.8 ? "" : ratio >= 0.5 ? "mid" : "low";
                  return `<div class="attempt-row">
                    <span class="attempt-icon">${item.level}</span>
                    <div class="attempt-copy"><strong>${esc(item.title || "仿真套题")}</strong><span>${shortDate(item.date)} · ${esc(item.type || "听力")}</span></div>
                    <span class="attempt-score ${scoreClass}">${item.score}/${item.total}</span>
                  </div>`;
                }).join("") : '<div class="empty-mini">还没有记录。做完第一组仿真题，这里就会亮起来。</div>'}
              </div>
            </section>
          </div>

          <aside>
            <section class="report-panel">
              <div class="report-panel-head">
                <div><h2>两边的进度</h2><p>按实际作答统计，不按播放次数。</p></div>
              </div>
              <div class="level-breakdown">
                ${levels.map(level => `
                  <div>
                    <div class="level-line-head"><span>CET-${level.level} · ${level.attempts} 组</span><b>${level.percent == null ? "—" : `${level.percent}%`}</b></div>
                    <div class="level-track cet${level.level}"><i style="width:${level.percent == null ? 0 : level.percent}%"></i></div>
                  </div>`).join("")}
              </div>
            </section>

            <section class="report-panel">
              <div class="report-panel-head"><div><h2>四周，只做四件事。</h2><p>不用每天刷很多，按顺序来。</p></div></div>
              <div class="plan-list">
                <div class="plan-row"><span class="plan-week">W1</span><div class="plan-copy"><strong>只听结构</strong><p>每套题只回答「谁、在哪、做了什么」，不纠结生词。</p></div></div>
                <div class="plan-row"><span class="plan-week">W2</span><div class="plan-copy"><strong>逐句精听</strong><p>每天 3 句听写，专攻连读、弱读和数字。</p></div></div>
                <div class="plan-row"><span class="plan-week">W3</span><div class="plan-copy"><strong>开口跟读</strong><p>每天 2 句录音，先模仿节奏，再纠正发音。</p></div></div>
                <div class="plan-row"><span class="plan-week">W4</span><div class="plan-copy"><strong>限时模考</strong><p>一次完成一组，不暂停、不回看，最后统一核对。</p></div></div>
              </div>
            </section>

            <div class="report-actions">
              <button class="btn btn-ghost" data-action="export-data">导出记录</button>
              <button class="btn btn-danger" data-action="reset-data">${state.confirmReset ? "再点一次确认清空" : "清空记录"}</button>
              <span class="report-footnote">只存本机</span>
            </div>
          </aside>
        </div>
      </div>`;
  }

  /* --------------------------------------------------------------- rendering */
  function render() {
    if (state.view === "practice" && !state.practice) state.view = "library";
    if (state.view === "intensive" && !D.intensive.length) state.view = "home";
    if (state.view === "shadow" && !D.shadow.length) state.view = "home";
    const renderers = {
      home: renderHome,
      library: renderLibrary,
      practice: renderPractice,
      intensive: renderIntensive,
      shadow: renderShadow,
      report: renderReport
    };
    app.innerHTML = (renderers[state.view] || renderHome)();
    syncChrome();
    populateVoiceSelects();
  }

  function syncChrome() {
    const today = dayRecord(false);
    const completed = Array.isArray(today.completed) ? today.completed : [];
    const minutes = Number(today.minutes) || 0;
    $$("[data-level]").forEach(button => {
      button.classList.toggle("is-on", Number(button.dataset.level) === state.level);
    });
    $$(".side-nav [data-view], .mobile-tabbar [data-view]").forEach(button => {
      button.classList.toggle("is-active", button.dataset.view === state.view);
    });
    const sideMinutes = document.getElementById("side-minutes");
    if (sideMinutes) sideMinutes.textContent = `${minutes} min`;
    const sideProgress = document.getElementById("side-progress");
    if (sideProgress) sideProgress.style.width = `${Math.min(100, Math.round(minutes / 15 * 100))}%`;
    const sideRoutes = document.getElementById("side-route-count");
    if (sideRoutes) sideRoutes.textContent = `${Math.min(3, completed.length)} / 3`;
    const sideStreak = document.getElementById("side-streak");
    if (sideStreak) sideStreak.textContent = String(calcStreak());

    const labels = {
      home: "今日训练",
      library: "仿真题库",
      practice: "仿真题库",
      intensive: "精听拆句",
      shadow: "跟读录音",
      report: "学习报告"
    };
    const crumb = document.getElementById("crumb");
    if (crumb) {
      let extra = "";
      if (state.view === "practice" && state.practice) {
        const set = getSet(state.practice.setId);
        if (set) {
          const setIndex = setsForLevel(set.level).findIndex(item => item.id === set.id);
          extra = ` <span>/</span> SET ${pad2(setIndex + 1)}`;
        }
      }
      crumb.innerHTML = `训练室 <span>/</span> ${labels[state.view] || "今日训练"}${extra}`;
    }
    document.title = `${labels[state.view] || "听力实验室"} · 听见 CET-4/6`;
  }

  /* ------------------------------------------------------------------ routing */
  function prepareViewChange() {
    if (state.shadow.isRecording) cancelRecording();
    stopSpeech();
  }

  function setView(view) {
    if (!view || !["home", "library", "practice", "intensive", "shadow", "report"].includes(view)) return;
    prepareViewChange();
    state.view = view;
    state.confirmReset = false;
    if (view === "library") state.libraryFilter = "全部";
    render();
    scrollTop();
  }

  function openPractice(id) {
    const set = getSet(id);
    if (!set) return;
    prepareViewChange();
    audio.rate = 1;
    state.practice = { setId: id, answers: {}, submitted: false, score: 0 };
    state.view = "practice";
    state.confirmReset = false;
    render();
    scrollTop();
  }

  function nextSet() {
    if (!state.practice) return;
    const current = getSet(state.practice.setId);
    if (!current) return;
    const list = setsForLevel(current.level);
    const index = list.findIndex(item => item.id === current.id);
    const next = list[(index + 1) % list.length];
    openPractice(next.id);
  }

  function startRoute(route) {
    if (route === "practice") {
      const set = recommendedSet();
      if (set) openPractice(set.id);
      return;
    }
    if (route === "intensive") {
      const day = dayRecord();
      const done = new Set(day.dictations || []);
      const index = D.intensive.findIndex(item => !done.has(item.id));
      state.intensive = {
        index: index >= 0 ? index : 0,
        input: "",
        checked: false,
        revealed: false,
        result: null,
        slow: false,
        loop: false
      };
      setView("intensive");
      return;
    }
    if (route === "shadow") {
      state.shadow.index = 0;
      state.shadow.checks = [false, false, false];
      setView("shadow");
    }
  }

  /* ------------------------------------------------------------- practice acts */
  function startPracticeAudio() {
    const set = state.practice ? getSet(state.practice.setId) : null;
    if (!set) return;
    if (audio.mode === "practice" && audio.playing) {
      togglePause();
      return;
    }
    playSequence(set.sentences, { mode: "practice", start: 0, rate: audio.rate || 1 });
  }

  function selectAnswer(qIndex, optionIndex) {
    if (!state.practice || state.practice.submitted) return;
    state.practice.answers[qIndex] = optionIndex;
    const card = document.querySelector(`.question-card[data-question="${qIndex}"]`);
    if (card) {
      $$(".option", card).forEach(option => {
        const selected = Number(option.dataset.opt) === optionIndex;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-pressed", String(selected));
      });
    }
    const set = getSet(state.practice.setId);
    const total = set ? set.questions.length : 0;
    const answered = Object.keys(state.practice.answers).length;
    const counter = document.getElementById("answeredCount");
    if (counter) counter.innerHTML = `<b>${answered}</b> / ${total} 已作答`;
    const progress = document.getElementById("answerProgress");
    if (progress) progress.style.width = `${total ? answered / total * 100 : 0}%`;
    const submit = document.getElementById("submitPractice");
    if (submit) submit.disabled = answered < total;
  }

  function submitPractice() {
    if (!state.practice || state.practice.submitted) return;
    const set = getSet(state.practice.setId);
    if (!set) return;
    const total = set.questions.length;
    if (Object.keys(state.practice.answers).length < total) {
      toast("还有题目没有作答。");
      return;
    }
    let score = 0;
    set.questions.forEach((question, index) => {
      if (state.practice.answers[index] === question.answer) score += 1;
    });
    state.practice.score = score;
    state.practice.submitted = true;
    stopSpeech();

    const day = dayRecord(true);
    day.minutes = (Number(day.minutes) || 0) + 8;
    if (!Array.isArray(day.completed)) day.completed = [];
    if (!day.completed.includes("practice")) day.completed.push("practice");
    store.totals.answered = (Number(store.totals.answered) || 0) + total;
    store.totals.correct = (Number(store.totals.correct) || 0) + score;
    store.totals.sessions = (Number(store.totals.sessions) || 0) + 1;
    store.attempts.unshift({
      id: set.id,
      title: set.titleZh,
      type: typeLabel(set),
      level: set.level,
      score,
      total,
      date: Date.now()
    });
    store.attempts = store.attempts.slice(0, 80);
    saveStore();
    render();
    window.setTimeout(() => {
      const banner = document.querySelector(".result-banner");
      if (banner) banner.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    toast(`交卷完成：${score} / ${total}。原文已展开。`);
  }

  function playTranscript(index) {
    const set = state.practice ? getSet(state.practice.setId) : null;
    if (!set || !set.sentences[index]) return;
    playSequence([set.sentences[index]], {
      mode: "sentence",
      rate: audio.rate || 1,
      transcriptIndex: index
    });
  }

  /* ------------------------------------------------------------ intensive acts */
  function resetIntensive(index) {
    state.intensive = { index, input: "", checked: false, revealed: false, result: null, slow: false, loop: false };
    stopSpeech();
    audio.rate = 1;
    audio.loop = false;
    render();
    scrollTop();
  }

  function playIntensive() {
    const item = D.intensive[state.intensive.index];
    if (!item) return;
    if (audio.mode === "intensive" && audio.playing) {
      togglePause();
      return;
    }
    playSequence([{ en: item.text }], {
      mode: "intensive",
      rate: state.intensive.slow ? 0.75 : 1,
      loop: state.intensive.loop
    });
  }

  function checkDictation() {
    if (state.intensive.checked) return;
    const item = D.intensive[state.intensive.index];
    if (!item) return;
    const input = state.intensive.input.trim();
    if (!input) {
      toast("先写下你听到的内容，再检查。");
      return;
    }
    const result = diffWords(input, item.text);
    state.intensive.result = result;
    state.intensive.checked = true;

    const day = dayRecord(true);
    if (!Array.isArray(day.dictations)) day.dictations = [];
    if (!day.dictations.includes(item.id)) {
      day.dictations.push(item.id);
      day.minutes = (Number(day.minutes) || 0) + 1;
      if (!Array.isArray(day.completed)) day.completed = [];
      if (!day.completed.includes("intensive")) day.completed.push("intensive");
      saveStore();
    }
    stopSpeech();
    render();
    window.setTimeout(() => {
      const resultEl = document.querySelector(".check-result");
      if (resultEl) resultEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 70);
    if (D.intensive.every(entry => (dayRecord().dictations || []).includes(entry.id))) {
      toast("12 句精听全部完成。今天可以收工了。");
    }
  }

  function revealAnswer() {
    if (state.intensive.checked) return;
    const item = D.intensive[state.intensive.index];
    if (!item) return;
    state.intensive.revealed = true;
    state.intensive.checked = true;
    state.intensive.result = diffWords(state.intensive.input, item.text);
    stopSpeech();
    render();
  }

  function nextIntensive() {
    const next = (state.intensive.index + 1) % D.intensive.length;
    resetIntensive(next);
  }

  /* --------------------------------------------------------------- shadow acts */
  let mediaSession = null;
  let recordTimer = null;

  function updateRecordingUI() {
    const button = document.querySelector("[data-action='record-shadow']");
    const strong = document.querySelector(".record-copy strong");
    const small = document.querySelector(".record-copy small");
    const timer = document.getElementById("recordTimer");
    if (button) {
      button.classList.toggle("is-recording", state.shadow.isRecording);
      button.setAttribute("aria-label", state.shadow.isRecording ? "停止录音" : "开始录音");
    }
    if (strong) strong.textContent = state.shadow.isRecording ? "正在录音…" : "录下你的版本";
    if (small) small.textContent = state.shadow.isRecording ? "再次点击停止 · 最长 30 秒" : "麦克风只在本机使用，不会上传";
    if (timer) {
      timer.style.display = state.shadow.isRecording ? "inline" : "none";
      if (!state.shadow.isRecording) timer.textContent = "00:00";
    }
  }

  async function toggleRecording() {
    if (state.shadow.isRecording) {
      if (mediaSession && mediaSession.recorder.state !== "inactive") mediaSession.recorder.stop();
      return;
    }
    if (!canRecord()) {
      toast("这个浏览器不支持网页录音，请使用 Edge 或 Chrome。");
      return;
    }
    stopSpeech();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (state.view !== "shadow") {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType = preferred.find(type => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks = [];
      mediaSession = {
        recorder,
        stream,
        chunks,
        startedAt: Date.now(),
        discarding: false
      };
      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        toast("录音失败，请检查麦克风权限。");
      };
      recorder.onstop = () => {
        const session = mediaSession;
        if (session) {
          session.stream.getTracks().forEach(track => track.stop());
        }
        window.clearInterval(recordTimer);
        recordTimer = null;
        state.shadow.isRecording = false;
        if (!session || session.discarding) {
          mediaSession = null;
          return;
        }
        if (chunks.length) {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          if (state.shadow.blobUrl) URL.revokeObjectURL(state.shadow.blobUrl);
          state.shadow.blobUrl = URL.createObjectURL(blob);
          const day = dayRecord(true);
          if (!Array.isArray(day.completed)) day.completed = [];
          if (!day.completed.includes("shadow")) {
            day.minutes = (Number(day.minutes) || 0) + 2;
            day.completed.push("shadow");
            saveStore();
          }
          toast("录音已保存。先听自己的，再听原句。");
        }
        mediaSession = null;
        if (state.view === "shadow") {
          render();
          window.setTimeout(() => {
            const comparison = document.querySelector(".record-comparison");
            if (comparison) comparison.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 80);
        }
      };
      recorder.start(250);
      state.shadow.isRecording = true;
      updateRecordingUI();
      const updateTimer = () => {
        const timer = document.getElementById("recordTimer");
        if (!state.shadow.isRecording || !mediaSession) return;
        const elapsed = Math.floor((Date.now() - mediaSession.startedAt) / 1000);
        if (timer) timer.textContent = formatSeconds(Math.min(elapsed, 30));
        if (elapsed >= 30 && mediaSession.recorder.state === "recording") {
          mediaSession.recorder.stop();
        }
      };
      updateTimer();
      recordTimer = window.setInterval(updateTimer, 300);
    } catch (error) {
      state.shadow.isRecording = false;
      updateRecordingUI();
      if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        toast("麦克风权限被拒绝。允许浏览器访问麦克风后再试。");
      } else if (error && error.name === "NotFoundError") {
        toast("没有找到可用的麦克风。");
      } else {
        toast("无法开始录音，请检查麦克风或改用本地服务器打开。");
      }
    }
  }

  function cancelRecording() {
    if (mediaSession) {
      mediaSession.discarding = true;
      if (mediaSession.recorder.state !== "inactive") {
        try { mediaSession.recorder.stop(); } catch (error) { /* 忽略 */ }
      }
      mediaSession.stream.getTracks().forEach(track => track.stop());
      window.clearInterval(recordTimer);
      recordTimer = null;
      mediaSession = null;
    }
    state.shadow.isRecording = false;
  }

  function selectShadow(index) {
    if (index === state.shadow.index) return;
    cancelRecording();
    stopSpeech();
    if (state.shadow.blobUrl) URL.revokeObjectURL(state.shadow.blobUrl);
    state.shadow = { index, isRecording: false, blobUrl: "", checks: [false, false, false] };
    render();
    scrollTop();
  }

  function playShadow() {
    const item = D.shadow[state.shadow.index];
    if (!item) return;
    if (audio.mode === "shadow" && audio.playing) {
      togglePause();
      return;
    }
    playSequence([{ en: item.text }], { mode: "shadow", rate: 0.95 });
  }

  /* ---------------------------------------------------------------- report acts */
  function exportData() {
    const payload = {
      app: "听见 · CET 听力实验室",
      exportedAt: new Date().toISOString(),
      settings: store.settings,
      totals: store.totals,
      days: store.days,
      attempts: store.attempts
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tingjian-cet-progress-${dateKey()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast("学习记录已导出为 JSON。");
    } catch (error) {
      toast("导出失败，请稍后再试。");
    }
  }

  function resetData() {
    if (!state.confirmReset) {
      state.confirmReset = true;
      render();
      toast("再点一次「确认清空」，记录才会被删除。");
      window.setTimeout(() => {
        if (state.confirmReset && state.view === "report") {
          state.confirmReset = false;
          render();
        }
      }, 5000);
      return;
    }
    store = defaultStore();
    state.level = 4;
    state.voiceURI = "";
    state.confirmReset = false;
    state.practice = null;
    state.intensive = { index: 0, input: "", checked: false, revealed: false, result: null, slow: false, loop: false };
    state.shadow = { index: 0, isRecording: false, blobUrl: "", checks: [false, false, false] };
    saveStore();
    setView("home");
    toast("学习记录已清空。");
  }

  function changeLevel(level) {
    const next = Number(level) === 6 ? 6 : 4;
    if (next === state.level) return;
    state.level = next;
    store.settings.level = next;
    saveStore();
    state.libraryFilter = "全部";
    if (state.view === "practice") {
      state.practice = null;
      state.view = "library";
    }
    render();
    scrollTop();
    toast(`已切换到 CET-${next} 题库。`);
  }

  /* ---------------------------------------------------------------- event bus */
  document.addEventListener("click", event => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      event.preventDefault();
      setView(viewButton.dataset.view);
      return;
    }

    const levelButton = event.target.closest("[data-level]");
    if (levelButton) {
      changeLevel(levelButton.dataset.level);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;

    switch (action) {
      case "open-help": {
        const dialog = document.getElementById("helpDialog");
        if (dialog && typeof dialog.showModal === "function") dialog.showModal();
        break;
      }
      case "close-help": {
        const dialog = document.getElementById("helpDialog");
        if (dialog) dialog.close();
        break;
      }
      case "start-daily": {
        const set = recommendedSet();
        if (set) openPractice(set.id);
        break;
      }
      case "start-route":
        startRoute(actionButton.dataset.route);
        break;
      case "open-set":
        openPractice(actionButton.dataset.id);
        break;
      case "filter-type":
        state.libraryFilter = actionButton.dataset.type || "全部";
        render();
        break;
      case "select-answer":
        selectAnswer(Number(actionButton.dataset.q), Number(actionButton.dataset.opt));
        break;
      case "submit-practice":
        submitPractice();
        break;
      case "next-set":
        nextSet();
        break;
      case "toggle-practice-audio":
        startPracticeAudio();
        break;
      case "set-rate": {
        const rate = Number(actionButton.dataset.rate) || 1;
        const wasPlaying = audio.playing && !audio.paused;
        const previousIndex = audio.index;
        audio.rate = rate;
        if (wasPlaying && audio.sentences.length) {
          playSequence(audio.sentences, { mode: audio.mode, start: previousIndex, rate, loop: audio.loop });
        } else {
          updateAudioUI();
        }
        break;
      }
      case "prev-sentence":
      case "next-sentence": {
        if (!state.practice) break;
        const set = getSet(state.practice.setId);
        if (!set) break;
        const delta = action === "prev-sentence" ? -1 : 1;
        const index = Math.max(0, Math.min(set.sentences.length - 1, audio.index + delta));
        playSequence(set.sentences, { mode: "practice", start: index, rate: audio.rate || 1 });
        break;
      }
      case "replay-sentence": {
        if (!state.practice) break;
        const set = getSet(state.practice.setId);
        if (!set) break;
        if (audio.mode === "practice" && audio.sentences.length) {
          playSequence(set.sentences, { mode: "practice", start: audio.index, rate: audio.rate || 1 });
        } else {
          playSequence(set.sentences, { mode: "practice", start: 0, rate: audio.rate || 1 });
        }
        break;
      }
      case "play-transcript":
        playTranscript(Number(actionButton.dataset.sentence));
        break;
      case "play-quote":
        speakText(DAILY_QUOTE.en, { mode: "quote", rate: 0.95 });
        break;
      case "play-intensive":
        playIntensive();
        break;
      case "toggle-slow":
        state.intensive.slow = !state.intensive.slow;
        audio.rate = state.intensive.slow ? 0.75 : 1;
        actionButton.classList.toggle("is-on", state.intensive.slow);
        if (audio.playing && audio.mode === "intensive") {
          const item = D.intensive[state.intensive.index];
          playSequence([{ en: item.text }], { mode: "intensive", rate: audio.rate, loop: audio.loop });
        }
        break;
      case "toggle-loop":
        state.intensive.loop = !state.intensive.loop;
        audio.loop = state.intensive.loop;
        actionButton.classList.toggle("is-on", state.intensive.loop);
        break;
      case "check-dictation":
        checkDictation();
        break;
      case "reveal-answer":
        revealAnswer();
        break;
      case "next-intensive":
        nextIntensive();
        break;
      case "go-intensive": {
        const index = Number(actionButton.dataset.index);
        if (Number.isInteger(index)) resetIntensive(index);
        break;
      }
      case "play-shadow":
        playShadow();
        break;
      case "record-shadow":
        toggleRecording();
        break;
      case "select-shadow":
        selectShadow(Number(actionButton.dataset.index));
        break;
      case "toggle-check": {
        const index = Number(actionButton.dataset.check);
        state.shadow.checks[index] = !state.shadow.checks[index];
        actionButton.classList.toggle("is-on", state.shadow.checks[index]);
        break;
      }
      case "export-data":
        exportData();
        break;
      case "reset-data":
        resetData();
        break;
      default:
        break;
    }
  });

  document.addEventListener("input", event => {
    if (event.target.id === "dictationInput") {
      state.intensive.input = event.target.value;
      const button = document.getElementById("checkDictation");
      if (button) button.disabled = !state.intensive.input.trim();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.target.id === "dictationInput" && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      checkDictation();
    }
  });

  document.addEventListener("change", event => {
    if (event.target.matches(".js-voice-select")) {
      state.voiceURI = event.target.value;
      store.settings.voiceURI = state.voiceURI;
      saveStore();
      if (state.voiceURI) toast("音色已切换，下一次播放时生效。");
    }
  });

  const helpDialog = document.getElementById("helpDialog");
  if (helpDialog) {
    helpDialog.addEventListener("click", event => {
      if (event.target === helpDialog) helpDialog.close();
    });
  }

  window.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (state.view === "practice" || state.view === "intensive" || state.view === "shadow") {
        if (!(helpDialog && helpDialog.open)) stopSpeech();
      }
    }
  });

  window.addEventListener("pagehide", () => {
    cancelRecording();
    if (state.shadow.blobUrl) URL.revokeObjectURL(state.shadow.blobUrl);
  });

  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
    window.setTimeout(loadVoices, 500);
    window.setTimeout(loadVoices, 1800);
  } else {
    populateVoiceSelects();
  }

  render();
})();