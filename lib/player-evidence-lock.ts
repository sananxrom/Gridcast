/** Cooperative origin-local coordination; authorization is enforced separately online. */
const channelName = 'gridcast-evidence-maintenance-v1';
const lockName = (device: string) => 'gridcast-evidence:' + device;
export function joinPlayerEvidence(device: string, ready: () => void, pause: () => Promise<void>, failed: (message: string) => void) {
  if (!navigator.locks || typeof BroadcastChannel === 'undefined') { ready(); return { stop: (settled?: Promise<void>) => { void settled?.catch(error => failed(error.message || 'A result could not be saved. Keep this player open.')); } }; }
  let closed = false, pausing = false, release: (() => void) | undefined;
  const channel = new BroadcastChannel(channelName), controller = new AbortController();
  channel.onmessage = async event => {
    if (closed || pausing || !release || event.data?.type !== 'pause' || event.data.device !== device) return;
    pausing = true;
    try { await pause(); release?.(); } catch (error: any) { failed(error.message || 'Saved records could not be finalized. Keep this player open.'); }
    finally { pausing = false; }
  };
  void (async () => {
    try {
      while (!closed) await navigator.locks.request(lockName(device), { mode: 'shared', signal: controller.signal }, async () => {
        if (closed) return;
        await new Promise<void>(resolve => { release = resolve; ready(); });
        release = undefined;
      });
    } catch (error: any) { if (!closed) failed(error.message || 'Player coordination is unavailable.'); }
  })();
  return { stop(settled: Promise<void> = Promise.resolve()) {
    closed = true; controller.abort(); channel.close();
    // Keep the shared lock until all already-started evidence writes have settled.
    void settled.then(() => release?.(), error => failed(error.message || 'A result could not be saved. Keep this player open.'));
  } };
}
export async function withPlayerEvidence<T>(device: string, action: () => Promise<T>): Promise<T> {
  if (!device?.trim()) throw new Error('An explicit device identity is required.');
  if (!navigator.locks || typeof BroadcastChannel === 'undefined') throw new Error('This browser cannot coordinate saved records safely. Use a current supported browser.');
  const channel = new BroadcastChannel(channelName), controller = new AbortController();
  const ask = () => channel.postMessage({ type: 'pause', device });
  const timeout = setTimeout(() => controller.abort(), 12000), timer = setInterval(ask, 250);
  try {
    // Queue exclusive access before requesting current players to release their shared locks.
    const waiting = navigator.locks.request(lockName(device), { signal: controller.signal }, async () => {
      clearTimeout(timeout); clearInterval(timer);
      return action();
    });
    ask();
    return await waiting;
  } catch (error: any) {
    if (error.name === 'AbortError') throw new Error('Another player tab is still saving records. Keep it open and retry.');
    throw error;
  } finally { clearTimeout(timeout); clearInterval(timer); channel.close(); }
}

/** Old player tabs do not hold the evidence lock. Require their reload before maintenance. */
export function answerEvidenceProtocol() {
  const answer = (event: MessageEvent) => {
    if (event.data?.type === 'GRIDCAST_EVIDENCE_PROTOCOL' && event.ports[0]) event.ports[0].postMessage({ protocol: 1 });
  };
  navigator.serviceWorker?.addEventListener('message', answer);
  return () => navigator.serviceWorker?.removeEventListener('message', answer);
}
export async function verifyPlayerTabs() {
  if (!('serviceWorker' in navigator)) throw new Error('Maintenance needs service-worker support to check other player tabs.');
  const registration = await navigator.serviceWorker.register('/player-sw.js', { scope: '/player' });
  await registration.update();
  const until = Date.now() + 8000;
  while ((!registration.active || registration.installing || registration.waiting) && Date.now() < until) await new Promise(r => setTimeout(r, 100));
  const worker = registration.active;
  if (!worker || registration.installing || registration.waiting) throw new Error('Player update is still installing. Wait, then retry maintenance.');
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Could not check other player tabs. Reload every player tab and retry.')); }, 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      if (event.data?.protocol === 1 && event.data?.allSupported === true) resolve();
      else reject(new Error('An older player tab is open. Reload every player tab before maintenance; do not clear browser storage.'));
    };
    worker.postMessage({ type: 'GRIDCAST_CHECK_PLAYER_TABS' }, [channel.port2]);
  });
}

export type EvidenceLease = { device: string; run<T>(action: () => Promise<T>): Promise<T>; release(): void };
/** A bounded caller-owned pause across review/download/acknowledgement, never persisted. */
export async function holdPlayerEvidence(device: string): Promise<EvidenceLease> {
  return new Promise((resolve,reject) => {
    void withPlayerEvidence(device,async()=>{
      let closing=false,running=0,unlock!:()=>void;
      const ended=new Promise<void>(done=>{unlock=done;});
      const finish=()=>{if(closing&&!running)unlock();};
      resolve({device,async run<T>(action:()=>Promise<T>){if(closing)throw new Error('Maintenance pause has closed.');running++;try{return await action();}finally{running--;finish();}},release(){closing=true;finish();}});
      await ended;
    }).catch(reject);
  });
}
