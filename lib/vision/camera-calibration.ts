export function localCameraRef(deviceId:string,screenId:string,track:MediaStreamTrack,width:number,height:number,rotation:number){
  const key=`gridcast-attention-camera-ref:${deviceId}:${screenId}`,settings=track.getSettings();
  const fingerprint=JSON.stringify([settings.deviceId||'',settings.facingMode||'',width,height,rotation]);
  let saved:any=null;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
  if(saved?.fingerprint===fingerprint&&typeof saved.ref==='string')return saved.ref;
  const ref=crypto.randomUUID().replaceAll('-','');
  try{localStorage.setItem(key,JSON.stringify({fingerprint,ref}));}catch{}
  return ref;
}
export const localCalibrationKey=(deviceId:string,screenId:string)=>`gridcast-attention-calibration:${deviceId}:${screenId}`;
