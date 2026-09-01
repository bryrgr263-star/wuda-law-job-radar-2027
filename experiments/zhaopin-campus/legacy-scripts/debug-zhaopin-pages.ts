import * as cheerio from "cheerio";
import fs from "node:fs";
const clean=(v:string)=>v.replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
const law=/(?:专业要求|招聘专业|所学专业|专业方向|专业类别|专业背景|专业)[：:]?[^。；;\n]{0,45}(?:法学|法律(?:硕士|专业|相关专业|类)?)(?:等相关专业)?|(?:法学|法律硕士|法律专业|法律相关专业)(?:类|专业|背景|方向|相关)?/;
const is27=(t:string)=>/2027\s*(?:届|年度|校园招聘|校招)|27届|招聘年度[：:]?\s*2027/.test(t);
async function main(){
const html=fs.readFileSync("work/sou-zhaopin.html","utf8");
const $=cheerio.load(html);
const links=$("a.jobinfo__name").map((_,e)=>({url:new URL($(e).attr("href")!).toString().replace(/^http:/,"https:"),title:clean($(e).text())})).get();
for(const {url,title} of links){
 try{
  const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept-Language":"zh-CN,zh;q=0.9"}}); const h=await res.text(); const p=cheerio.load(h); p("script,style,noscript,svg").remove(); const pageText=clean(p("body").text()).slice(0,180000); const heading=clean(p("h1").first().text()); const doc=clean(p("title").text()); const pageTitle=heading.length>=2?heading:doc; const start=Math.max(0,pageText.indexOf(pageTitle)); const focused=pageText.slice(start,start+12000); const context=pageTitle+" "+focused;
  console.log(JSON.stringify({title,url,status:res.status,heading,doc,pageTitle,start,textLen:pageText.length,has27:is27(context),hasLaw:law.test(context.replace(/\s+/g,"")),lawPos:focused.search(/法学|法律专业|法律相关专业/),sample:focused.slice(0,300)}));
 }catch(e){console.log(JSON.stringify({title,url,error:String(e)}))}
}

}
main();

