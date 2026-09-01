import * as cheerio from "cheerio";
const urls=[
  "https://www.zhaopin.com/jobdetail/CC144501720J40892181005.htm",
  "https://www.zhaopin.com/jobdetail/CC195681010J40874653201.htm",
  "https://www.zhaopin.com/jobdetail/CC286629730J40890605605.htm"
];
const clean=(v:string)=>v.replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
async function main(){for(const url of urls){const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});const h=await r.text();const $=cheerio.load(h);$("script,style,noscript,svg").remove();const t=clean($("body").text());const title=clean($("h1").first().text());const s=t.slice(Math.max(0,t.indexOf(title)));console.log("\n"+title);for(const needle of ["法学","法律专业","法律相关专业","工作地点 公司信息","公司信息","职位推荐"]){console.log(needle,s.indexOf(needle))}const p=Math.max(s.indexOf("法学"),s.indexOf("法律专业"),s.indexOf("法律相关专业"));console.log(s.slice(Math.max(0,p-300),p+500));}}
main();
