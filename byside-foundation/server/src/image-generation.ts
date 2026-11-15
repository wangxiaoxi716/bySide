import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {BadRequestException, BadGatewayException, ServiceUnavailableException} from '@nestjs/common';
const run=promisify(execFile);
const pngHeader=Buffer.from([137,80,78,71,13,10,26,10]);
const prompt='根据用户提供的参考图片，制作一个适合桌边 AI 陪伴的单个卡通角色。保留主体可辨认的特征、颜色和气质，将其转化为温暖可爱的毛绒玩偶形象。居中展示完整角色，画面无文字、无边框、无其他人物；透明背景。';
export function parseReferenceImage(input:unknown){
 if(typeof input!=='string'||input.length>2_000_000)throw new BadRequestException('参考图片无效或过大');
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);if(!match)throw new BadRequestException('请上传 PNG、JPEG 或 WebP 图片');
 const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>1_500_000)throw new BadRequestException('参考图片过大');
 const mime='image/'+match[1];const valid=match[1]==='png'?bytes.subarray(0,8).equals(pngHeader):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!valid)throw new BadRequestException('图片内容与格式不匹配');return {mime,bytes};
}
async function getKey(){if(process.env.PETS_IMAGE_API_KEY?.trim())return process.env.PETS_IMAGE_API_KEY.trim();try{const {stdout}=await run('security',['find-generic-password','-s','third-party-pets-image-api','-w'],{timeout:5000,maxBuffer:4096});return stdout.trim();}catch{return '';}}
export async function generateCharacter(input:unknown,options:{key?:string;fetch?:typeof fetch}={}){
 const {mime,bytes}=parseReferenceImage(input);const key=options.key??await getKey();if(!key)throw new ServiceUnavailableException('尚未配置生图密钥，请在本机钥匙串设置 third-party-pets-image-api');
 const form=new FormData();form.set('model','gpt-image-2');form.set('prompt',prompt);form.set('size','1024x1024');form.set('image',new Blob([new Uint8Array(bytes)],{type:mime}),`reference.${mime.split('/')[1]}`);
 let res:Response;try{res=await (options.fetch??fetch)('https://api.openai-next.com/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(120000),redirect:'error'});}catch{throw new BadGatewayException('生图服务连接失败，请稍后重试');}
 if(!res.ok)throw new BadGatewayException(`生图服务请求失败（HTTP ${res.status}），请检查服务和权限`);
 const data:any=await res.json().catch(()=>null);const encoded=data?.data?.[0]?.b64_json;if(typeof encoded!=='string'||encoded.length>12_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new BadGatewayException('生图服务未返回有效图片');
 const output=Buffer.from(encoded,'base64');if(output.length>8_000_000||!output.subarray(0,8).equals(pngHeader))throw new BadGatewayException('生图服务返回的图片格式不受支持');return output;
}
