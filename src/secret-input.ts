/** Hidden TTY input. Secrets are never accepted as command-line arguments. */
export async function readSecret(prompt:string):Promise<string>{
 if(!process.stdin.isTTY||!process.stdin.setRawMode)throw Error('An interactive terminal is required to unlock the credential vault');
 const input=process.stdin,wasRaw=input.isRaw;process.stderr.write(prompt);input.setEncoding('utf8');input.setRawMode(true);input.resume();
 return new Promise((resolve,reject)=>{let value='';const finish=(error?:Error)=>{input.removeListener('data',onData);input.removeListener('end',onEnd);input.setRawMode(wasRaw);input.pause();process.stderr.write('\n');if(error)reject(error);else resolve(value);};const onEnd=()=>finish(Error('Secret input ended'));const onData=(chunk:string)=>{for(const ch of chunk){if(ch==='\r'||ch==='\n'){finish();return;}if(ch==='\u0003'){finish(Error('Secret input cancelled'));return;}if(ch==='\u007f'||ch==='\b'){value=[...value].slice(0,-1).join('');continue;}if(/[\u0000-\u001f]/.test(ch))continue;value+=ch;if(Buffer.byteLength(value)>16384){finish(Error('Secret input exceeds limit'));return;}}};input.on('data',onData);input.once('end',onEnd);});
}
