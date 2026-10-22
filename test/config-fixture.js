'use strict';
class Config { constructor(){this.profiles=[];} upsertProfile(p){this.profiles=this.profiles.filter(x=>x.id!==p.id).concat(p);return {ok:true};} effective(id){return this.profiles.find(x=>x.id===id);} view(){return {profiles:this.profiles};} }
module.exports={Config};
