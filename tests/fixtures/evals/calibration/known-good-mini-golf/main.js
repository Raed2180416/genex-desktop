// A hand-made, known-good answer to the mini-golf case: one hole, visible aim, controllable power,
// rolling physics with wall bounces, a stroke counter, sink detection and a replay. Self-contained:
// a 2D canvas renderer and a fixed-step simulation, no dependencies, no network.
(() => {
  const canvas = document.getElementById("course");
  const paint = canvas.getContext("2d");
  const strokesEl = document.getElementById("strokes");
  const powerEl = document.getElementById("power");
  const title = document.getElementById("title");
  const sunkPanel = document.getElementById("sunk");
  const sunkText = document.getElementById("sunk-text");

  const STEP = 1 / 120;
  const BALL_RADIUS = 8;
  const HOLE_RADIUS = 13;
  const MAX_SHOT_SPEED = 900;
  const ROLLING_DECEL = 90;
  const DRAG = 0.6;
  const RESTITUTION = 0.78;
  const REST_SPEED = 6;
  const SINK_SPEED = 380;
  const TEE = { x: 120, y: 480 };
  const HOLE = { x: 660, y: 130 };
  const WALLS = [
    { x: 0, y: 0, w: 800, h: 20 },
    { x: 0, y: 580, w: 800, h: 20 },
    { x: 0, y: 0, w: 20, h: 600 },
    { x: 780, y: 0, w: 20, h: 600 },
    { x: 360, y: 20, w: 30, h: 380 },
    { x: 540, y: 200, w: 180, h: 24 },
  ];
  const SLOPE = { x: 420, y: 260, w: 360, h: 200, ax: 0, ay: 55 };

  const state = {
    mode: "title",
    ball: { x: TEE.x, y: TEE.y, vx: 0, vy: 0 },
    aim: -Math.PI / 4,
    power: 0.5,
    strokes: 0,
  };

  function reset() {
    state.ball = { x: TEE.x, y: TEE.y, vx: 0, vy: 0 };
    state.aim = -Math.PI / 4;
    state.power = 0.5;
    state.strokes = 0;
    strokesEl.textContent = "0";
    sunkPanel.hidden = true;
    state.mode = "playing";
  }

  function start() {
    title.hidden = true;
    reset();
  }

  function atRest() {
    return Math.hypot(state.ball.vx, state.ball.vy) === 0;
  }

  function shoot() {
    if (state.mode !== "playing" || !atRest()) return;
    const speed = MAX_SHOT_SPEED * state.power;
    state.ball.vx = Math.cos(state.aim) * speed;
    state.ball.vy = Math.sin(state.aim) * speed;
    state.strokes += 1;
    strokesEl.textContent = String(state.strokes);
  }

  function collide(ball, wall) {
    const cx = Math.max(wall.x, Math.min(ball.x, wall.x + wall.w));
    const cy = Math.max(wall.y, Math.min(ball.y, wall.y + wall.h));
    let nx = ball.x - cx;
    let ny = ball.y - cy;
    let dist = Math.hypot(nx, ny);
    if (dist >= BALL_RADIUS) return;
    if (dist === 0) {
      nx = ball.vx === 0 ? 0 : -Math.sign(ball.vx);
      ny = ball.vy === 0 ? -1 : -Math.sign(ball.vy);
      dist = Math.hypot(nx, ny);
    }
    nx /= dist;
    ny /= dist;
    const overlap = BALL_RADIUS - Math.hypot(ball.x - cx, ball.y - cy);
    ball.x += nx * overlap;
    ball.y += ny * overlap;
    const along = ball.vx * nx + ball.vy * ny;
    if (along < 0) {
      ball.vx -= (1 + RESTITUTION) * along * nx;
      ball.vy -= (1 + RESTITUTION) * along * ny;
    }
  }

  function onSlope(ball) {
    return ball.x > SLOPE.x && ball.x < SLOPE.x + SLOPE.w && ball.y > SLOPE.y && ball.y < SLOPE.y + SLOPE.h;
  }

  function step() {
    const ball = state.ball;
    if (onSlope(ball) && !atRest()) {
      ball.vx += SLOPE.ax * STEP;
      ball.vy += SLOPE.ay * STEP;
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed === 0) return;
    const slowed = Math.max(0, speed - ROLLING_DECEL * STEP) * Math.exp(-DRAG * STEP);
    if (slowed < REST_SPEED) {
      ball.vx = 0;
      ball.vy = 0;
    } else {
      ball.vx *= slowed / speed;
      ball.vy *= slowed / speed;
    }
    ball.x += ball.vx * STEP;
    ball.y += ball.vy * STEP;
    for (const wall of WALLS) collide(ball, wall);
    const toHole = Math.hypot(ball.x - HOLE.x, ball.y - HOLE.y);
    if (toHole < HOLE_RADIUS && Math.hypot(ball.vx, ball.vy) < SINK_SPEED) sink();
  }

  function sink() {
    state.mode = "sunk";
    state.ball.x = HOLE.x;
    state.ball.y = HOLE.y;
    state.ball.vx = 0;
    state.ball.vy = 0;
    const word = state.strokes === 1 ? "stroke" : "strokes";
    sunkText.textContent = `You sank it in ${state.strokes} ${word}.`;
    sunkPanel.hidden = false;
  }

  function drawCourse() {
    paint.fillStyle = "#2f8a3c";
    paint.fillRect(0, 0, canvas.width, canvas.height);
    paint.fillStyle = "#35973f";
    for (let x = 20; x < 780; x += 40) paint.fillRect(x, 20, 20, 560);
    paint.fillStyle = "#2a7a35";
    paint.fillRect(SLOPE.x, SLOPE.y, SLOPE.w, SLOPE.h);
    paint.strokeStyle = "#cfe8c4";
    paint.lineWidth = 2;
    for (let x = SLOPE.x + 30; x < SLOPE.x + SLOPE.w; x += 60) {
      paint.beginPath();
      paint.moveTo(x, SLOPE.y + 60);
      paint.lineTo(x, SLOPE.y + 120);
      paint.lineTo(x - 8, SLOPE.y + 110);
      paint.moveTo(x, SLOPE.y + 120);
      paint.lineTo(x + 8, SLOPE.y + 110);
      paint.stroke();
    }
    paint.fillStyle = "#8b5a2b";
    for (const wall of WALLS) paint.fillRect(wall.x, wall.y, wall.w, wall.h);
    paint.fillStyle = "#101010";
    paint.beginPath();
    paint.arc(HOLE.x, HOLE.y, HOLE_RADIUS, 0, Math.PI * 2);
    paint.fill();
    paint.strokeStyle = "#eeeeee";
    paint.beginPath();
    paint.moveTo(HOLE.x, HOLE.y);
    paint.lineTo(HOLE.x, HOLE.y - 60);
    paint.stroke();
    paint.fillStyle = "#e23d3d";
    paint.fillRect(HOLE.x, HOLE.y - 60, 30, 18);
    paint.fillStyle = "#d8d2bd";
    paint.fillRect(TEE.x - 14, TEE.y - 14, 28, 28);
  }

  function drawAim() {
    if (state.mode !== "playing" || !atRest()) return;
    const length = 40 + state.power * 160;
    const { x, y } = state.ball;
    const tipX = x + Math.cos(state.aim) * length;
    const tipY = y + Math.sin(state.aim) * length;
    paint.strokeStyle = "#ffffff";
    paint.lineWidth = 3;
    paint.setLineDash([10, 8]);
    paint.beginPath();
    paint.moveTo(x, y);
    paint.lineTo(tipX, tipY);
    paint.stroke();
    paint.setLineDash([]);
    paint.fillStyle = "#f0b429";
    paint.beginPath();
    paint.arc(tipX, tipY, 6, 0, Math.PI * 2);
    paint.fill();
  }

  function drawBall() {
    const { x, y } = state.ball;
    paint.fillStyle = "#00000055";
    paint.beginPath();
    paint.arc(x + 3, y + 3, BALL_RADIUS, 0, Math.PI * 2);
    paint.fill();
    paint.fillStyle = "#ffffff";
    paint.beginPath();
    paint.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    paint.fill();
  }

  let last = performance.now();
  let pending = 0;
  function frame(now) {
    pending = Math.min(pending + (now - last) / 1000, 0.25);
    last = now;
    while (pending >= STEP) {
      if (state.mode === "playing") step();
      pending -= STEP;
    }
    drawCourse();
    drawAim();
    drawBall();
    powerEl.style.width = `${Math.round(state.power * 100)}%`;
    requestAnimationFrame(frame);
  }

  function pointerOnCourse(event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  }

  canvas.addEventListener("mousemove", (event) => {
    if (state.mode !== "playing" || !atRest()) return;
    const point = pointerOnCourse(event);
    const dx = point.x - state.ball.x;
    const dy = point.y - state.ball.y;
    state.aim = Math.atan2(dy, dx);
    state.power = Math.max(0.05, Math.min(1, Math.hypot(dx, dy) / 250));
  });
  canvas.addEventListener("click", shoot);

  window.addEventListener("keydown", (event) => {
    if (state.mode === "title") {
      start();
      return;
    }
    if (event.key === "r" || event.key === "R") reset();
    if (event.key === "ArrowLeft") state.aim -= 0.08;
    if (event.key === "ArrowRight") state.aim += 0.08;
    if (event.key === "ArrowUp") state.power = Math.min(1, state.power + 0.05);
    if (event.key === "ArrowDown") state.power = Math.max(0.05, state.power - 0.05);
    if (event.key === " ") {
      event.preventDefault();
      shoot();
    }
  });
  document.getElementById("play").addEventListener("click", start);
  document.getElementById("again").addEventListener("click", reset);

  requestAnimationFrame(frame);
})();
