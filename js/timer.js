// Rest timer: one countdown at a time, measured against an end timestamp so a
// backgrounded tab (throttled intervals) still finishes on time.

let cancelCurrent = null;
let audio = null;

// Browsers only allow sound after a user gesture, so this runs inside the click
// that starts the timer: create or resume the context and play a silent blip to unlock it.
function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!audio) audio = new Ctx();
    if (audio.state === 'suspended') audio.resume();
    const gain = audio.createGain();
    gain.gain.value = 0;
    const osc = audio.createOscillator();
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.01);
  } catch {
    audio = null;
  }
}

function beep() {
  if (!audio) return;
  try {
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    const osc = audio.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 880;
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  } catch {
    // no sound available; the vibration and the screen still show the end
  }
}

function vibrate() {
  if (typeof navigator.vibrate === 'function') navigator.vibrate(400); // absent on iPhones
}

// Call from a click handler. Starting a new timer cancels the running one.
export function startTimer(seconds, onTick, onDone) {
  if (cancelCurrent) cancelCurrent();
  unlockAudio();
  const end = Date.now() + seconds * 1000;
  let intervalId = null;

  const cancel = () => {
    clearInterval(intervalId);
    if (cancelCurrent === cancel) cancelCurrent = null;
  };

  let last = null;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    if (remaining !== last) {
      last = remaining;
      onTick(remaining);
    }
    if (remaining === 0) {
      cancel();
      beep();
      vibrate();
      onDone();
    }
  };

  cancelCurrent = cancel;
  intervalId = setInterval(tick, 250);
  tick();
  return cancel;
}
