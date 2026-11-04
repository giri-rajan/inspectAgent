// Injected into every recorded page: a visible cursor, click ripples, a lower-third caption and an
// honest wait timer for the sped-up model calls. Headless capture draws no cursor of its own.
(() => {
  if (window.__demo) return;
  const css = `
  #__demo-root{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
  #__demo-cursor{position:absolute;left:0;top:0;width:22px;height:22px;transform:translate(-2px,-2px);transition:transform .06s linear;filter:drop-shadow(0 2px 4px rgb(0 0 0/.6))}
  .__demo-ripple{position:absolute;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid #828fff;animation:__demo-rip .5s ease-out forwards}
  @keyframes __demo-rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
  #__demo-cap{position:absolute;left:50%;bottom:28px;max-width:56%;text-align:center;padding:12px 16px;border-radius:12px;background:rgb(15 16 17/.94);border:1px solid #34343a;color:#f7f8f8;opacity:0;transform:translate(-50%,8px);transition:opacity .35s,transform .35s}
  #__demo-cap.on{opacity:1;transform:translate(-50%,0)}
  #__demo-cap b{display:block;font-size:17px;font-weight:600;letter-spacing:-.01em}
  #__demo-cap span{display:block;margin-top:3px;font-size:14px;color:#8a8f98}
  #__demo-wait{position:absolute;right:32px;top:76px;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:rgb(15 16 17/.94);border:1px solid #34343a;color:#f7f8f8;font-size:14px;opacity:0;transition:opacity .25s}
  #__demo-wait.on{opacity:1}
  #__demo-wait i{width:8px;height:8px;border-radius:50%;background:#828fff;animation:__demo-p 1s infinite}
  #__demo-wait em{font-style:normal;color:#8a8f98;font-variant-numeric:tabular-nums}
  @keyframes __demo-p{50%{opacity:.3}}`;
  const mount = () => {
    if (document.getElementById("__demo-root")) return;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    const root = document.createElement("div");
    root.id = "__demo-root";
    root.innerHTML = `<svg id="__demo-cursor" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#010102" stroke-width="1.4" stroke-linejoin="round"/></svg>
      <div id="__demo-cap"><b></b><span></span></div><div id="__demo-wait"><i></i><span></span><em></em></div>`;
    document.body.appendChild(root);
    const cur = root.querySelector("#__demo-cursor");
    const p = window.__demoPos || { x: innerWidth / 2, y: innerHeight / 2 };
    cur.style.transform = `translate(${p.x - 2}px,${p.y - 2}px)`;
    document.addEventListener("mousemove", (e) => {
      window.__demoPos = { x: e.clientX, y: e.clientY };
      cur.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 2}px)`;
    }, true);
    document.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "__demo-ripple";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      root.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  let timer = null;
  window.__demo = {
    caption(title, sub = "") {
      mount();
      const c = document.getElementById("__demo-cap");
      if (!title) return c.classList.remove("on");
      c.querySelector("b").textContent = title;
      c.querySelector("span").textContent = sub;
      c.querySelector("span").style.display = sub ? "block" : "none";
      c.classList.add("on");
    },
    wait(label, factor) {
      mount();
      const w = document.getElementById("__demo-wait");
      const t0 = performance.now();
      w.querySelector("span").textContent = label;
      const tick = () => (w.querySelector("em").textContent = `${((performance.now() - t0) / 1000).toFixed(0)} s real · shown ${factor}× faster`);
      tick();
      clearInterval(timer);
      timer = setInterval(tick, 200);
      w.classList.add("on");
    },
    waitEnd() {
      clearInterval(timer);
      document.getElementById("__demo-wait")?.classList.remove("on");
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
