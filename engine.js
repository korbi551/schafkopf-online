'use strict';
// Schafkopf-Spiellogik, KI und Trainer (gemeinsam für alle Tische).
// Die Funktionen arbeiten auf dem modulweiten G (aktuelles Spiel) und ME (Sicht dieses Sitzes); run() setzt beides.
const SUITS=['E','G','H','S'];
const SUITNAME={E:'Eichel',G:'Gras',H:'Herz',S:'Schellen'};
const SUITSYM={E:'🌰',G:'🍃',H:'❤️',S:'🔔'};
const RANKS=['A','10','K','O','U','9','8','7'];
const PTS={A:11,'10':10,K:4,O:3,U:2,'9':0,'8':0,'7':0};
const RANKNAME={A:'Sau','10':'Zehn',K:'König',O:'Ober',U:'Unter','9':'Neun','8':'Acht','7':'Sieben'};
let NAMES=['Spieler 1','Spieler 2','Spieler 3','Spieler 4'];
const CARD={};
for(const s of SUITS)for(const r of RANKS)CARD[s+r]={s,r,id:s+r};
const cname=c=>SUITNAME[c.s]+'-'+RANKNAME[c.r];
const gameName=g=>g.type==='sau'?`Sauspiel auf die ${SUITNAME[g.suit]}-Sau`:g.type==='wenz'?'Wenz':`${SUITNAME[g.suit]}-Solo`;
let G=null,ME=0;
// ---------- Spiel-Logik ----------
function trumpSuit(g){return g.type==='sau'?'H':g.type==='solo'?g.suit:null}
function isTr(c,g){if(g.type==='wenz')return c.r==='U';return c.r==='O'||c.r==='U'||c.s===trumpSuit(g)}
function tList(g){if(g.type==='wenz')return['EU','GU','HU','SU'];const t=trumpSuit(g);return['EO','GO','HO','SO','EU','GU','HU','SU',t+'A',t+'10',t+'K',t+'9',t+'8',t+'7']}
function sOrder(g){return g.type==='wenz'?['A','10','K','O','9','8','7']:['A','10','K','9','8','7']}
function cat(c,g){return isTr(c,g)?'T':c.s}
function power(c,lc,g){if(isTr(c,g))return 100+(20-tList(g).indexOf(c.id));if(c.s===lc)return 50-sOrder(g).indexOf(c.r);return 0}
function tVal(c,g){const l=tList(g);return l.length-l.indexOf(c.id)}
function sortHand(h,g){
  const so=sOrder(g),tl=tList(g),su=['E','G','S','H'];
  const k=c=>isTr(c,g)?tl.indexOf(c.id):100+su.indexOf(c.s)*10+so.indexOf(c.r);
  return h.sort((a,b)=>k(a)-k(b));
}
function winner(trick,g){const lc=cat(trick[0].card,g);let b=trick[0];for(const t of trick)if(power(t.card,lc,g)>power(b.card,lc,g))b=t;return b}
function trickPts(cards){return cards.reduce((a,x)=>a+PTS[x.card.r],0)}

function legal(hand,g){
  const t=g.trick,sau=g.type==='sau';
  const isAce=c=>sau&&c.s===g.suit&&c.r==='A';
  const holds=sau&&!g.ranAway&&hand.some(isAce);
  const ofCalled=c=>sau&&!isTr(c,g)&&c.s===g.suit;
  if(!t.length){
    if(holds&&hand.filter(ofCalled).length<4)return hand.filter(c=>!(ofCalled(c)&&!isAce(c)));
    return hand.slice();
  }
  const lc=cat(t[0].card,g);
  const fol=hand.filter(c=>cat(c,g)===lc);
  if(fol.length){if(holds&&lc===g.suit)return fol.filter(isAce);return fol}
  if(holds&&hand.length>1)return hand.filter(c=>!isAce(c));
  return hand.slice();
}
function team(s){if(G.type==='sau')return(s===G.declarer||s===G.partner)?'P':'O';return s===G.declarer?'P':'O'}
function knows(me,o){if(me===o)return true;if(G.type!=='sau'||G.aceRevealed)return true;if(me===G.partner)return true;return o===G.declarer}
function relation(me,o){if(!knows(me,o))return'unknown';return team(me)===team(o)?'friend':'foe'}
function unseen(seat){
  const k=(G._id||0)+'|'+seat+'|'+G.played.size+'|'+G.hands[seat].length;
  if(UNM.k===k)return UNM.v;
  const h=new Set(G.hands[seat].map(c=>c.id));
  const v=Object.keys(CARD).filter(id=>!G.played.has(id)&&!h.has(id)).map(id=>CARD[id]);
  UNM={k,v};return v;
}
function suitLedBefore(lc){return G.tricks.some(t=>cat(t.cards[0].card,G)===lc)}
// Kann c noch von einem Gegner überstochen werden, der nach "seat" dran ist?
// Berücksichtigt: bereits gespielte Karten, wer in welcher Farbe/Trumpf frei ist, und ob der Nachfolgende Partner ist.
function beatenBy(c,lc,seat){
  const p=power(c,lc,G),tr=isTr(c,G),un=unseen(seat);
  const hiSame=!tr&&un.some(u=>cat(u,G)===lc&&power(u,lc,G)>p);
  const hiT=un.some(u=>isTr(u,G)&&power(u,lc,G)>p);
  const suitLeft=lc==='T'?0:un.filter(u=>cat(u,G)===lc).length;
  const af=afterSeats(seat);
  for(const q of af){
    if(relation(seat,q)==='friend')continue;
    const v=G.voids[q];
    if(lc==='T'){if(hiT&&!v.has('T'))return true;continue}
    if(hiSame&&!v.has(lc))return true;
    if(hiT&&!v.has('T')&&(v.has(lc)||suitLedBefore(lc)||suitLeft<af.length))return true;
  }
  return false;
}
function discardCost(c,hand){let k=PTS[c.r];if(isTr(c,G))k+=12+tVal(c,G)*2;else k+=hand.filter(x=>!isTr(x,G)&&x.s===c.s).length*.3;return k}
function smearVal(c){let v=PTS[c.r];if(isTr(c,G))v-=(c.r==='O'||c.r==='U')?25:6;return v}
function lowest(arr,hand){return arr.slice().sort((a,b)=>discardCost(a,hand)-discardCost(b,hand))[0]}
function cheapestWin(arr){const cost=c=>isTr(c,G)?tVal(c,G)*2+30:-PTS[c.r];return arr.slice().sort((a,b)=>cost(a)-cost(b))[0]}

// ---------- Trainer / KI ----------
function choose(seat){
  const hand=G.hands[seat],L=legal(hand,G);
  if(L.length===1)return{c:L[0],forced:true,why:G.trick.length?`Das ist deine einzige erlaubte Karte (Farb- bzw. Trumpfzwang${G.type==='sau'?' oder Rufsau-Regel':''}).`:'Das ist deine einzige erlaubte Karte.'};
  return G.trick.length?followChoice(seat,L):leadChoice(seat,L);
}
function leadChoice(seat,L){
  const g=G,hand=g.hands[seat];
  const outT=unseen(seat).filter(c=>isTr(c,g));
  const myT=L.filter(c=>isTr(c,g)).sort((a,b)=>tVal(b,g)-tVal(a,g));
  const topOut=outT.length?Math.max(...outT.map(c=>tVal(c,g))):0;
  const nonT=L.filter(c=>!isTr(c,g));
  const freshAces=nonT.filter(c=>c.r==='A'&&!suitLedBefore(c.s));
  const isDecl=seat===g.declarer,isPart=g.type==='sau'&&seat===g.partner;
  if(isDecl||isPart){
    const who=isDecl?'Als Spieler':'Als Partner des Spielers';
    if(myT.length&&outT.length){
      if(tVal(myT[0],g)>topOut)return{c:myT[0],why:`<b>${cname(myT[0])}</b> ist der höchste Trumpf, der noch im Spiel ist. ${who} ziehst du Trumpf: Die Gegner müssen ihre Trümpfe zugeben und können deine Farbsauen später nicht mehr stechen.`};
      if(isDecl||myT.length>=2){const c=myT[myT.length-1];return{c,why:`„Der Spieler spielt Trumpf.“ Der höchste Trumpf ist aber noch draußen – deshalb mit einem kleinen Trumpf (<b>${cname(c)}</b>) die Trümpfe der Gegner herauslocken und die hohen für später aufheben.`}}
    }
    if(freshAces.length)return{c:freshAces[0],why:outT.length?`Eine Farbsau im ersten Umlauf ist fast sicher – hol dir die ${PTS.A} Augen, bevor jemand frei ist.`:`Die Gegner haben keine Trümpfe mehr – jetzt in Ruhe die Farbsauen abholen (<b>${cname(freshAces[0])}</b>).`};
    const tens=nonT.filter(c=>c.r==='10'&&g.played.has(c.s+'A'));
    if(tens.length&&!outT.length)return{c:tens[0],why:'Die Sau dieser Farbe ist schon gefallen und die Gegner haben keinen Trumpf mehr – die Zehn ist jetzt die höchste Karte.'};
    if(myT.length&&!outT.length)return{c:myT[0],why:'Die Gegner haben keine Trümpfe mehr – jeder Trumpf von dir ist jetzt ein sicherer Stich.'};
    const c=nonT.length?lowest(nonT,hand):lowest(L,hand);
    return{c,why:'Nichts Starkes mehr zum Ausspielen – gib eine Karte mit möglichst wenig Augen her und warte auf deine Trümpfe.'};
  }
  if(g.type==='sau'&&!g.calledLed){
    const cs=nonT.filter(c=>c.s===g.suit);
    if(cs.length){const c=lowest(cs,hand);return{c,why:`<b>Auf die Rufsau spielen!</b> Wer die ${SUITNAME[g.suit]}-Sau hat, muss sie jetzt zugeben. Dann ist klar, wer zusammenspielt – und ist einer von euch in ${SUITNAME[g.suit]} frei, kann er die Sau sogar stechen (11 Augen für euch).`}}
  }
  if(freshAces.length)return{c:freshAces[0],why:`„Der Gegner spielt Farbe.“ Eine Farbsau (<b>${cname(freshAces[0])}</b>) im ersten Umlauf bringt fast sicher Augen, solange noch keiner frei ist.`};
  if(nonT.length){const c=lowest(nonT,hand);return{c,why:`„Der Gegner spielt Farbe, nicht Trumpf.“ Trumpf ausspielen würde dem Spieler nur helfen, seine Trümpfe zu verwenden. Darum eine niedrige Farbkarte (<b>${cname(c)}</b>).`}}
  const c=lowest(L,hand);return{c,why:'Du hast nur noch Trümpfe – spiel den kleinsten aus.'};
}
function followChoice(seat,L){
  const g=G,t=g.trick,lc=cat(t[0].card,g),hand=g.hands[seat];
  const w=winner(t,g),wp=power(w.card,lc,g),after=3-t.length;
  const pts=trickPts(t),rel=relation(seat,w.seat);
  const winners=L.filter(c=>power(c,lc,g)>wp);
  const safe=c=>after===0||!beatenBy(c,lc,seat);
  if(rel==='friend'){
    if(safe(w.card)){
      const c=L.slice().sort((a,b)=>smearVal(b)-smearVal(a))[0];
      if(PTS[c.r]>0&&smearVal(c)>0)return{c,why:`${NAMES[w.seat]} ist dein Partner und hat den Stich sicher – <b>schmieren!</b> Mit ${cname(c)} wirfst du ${PTS[c.r]} Augen für eure Partei rein.`};
      return{c:lowest(L,hand),why:`Dein Partner ${NAMES[w.seat]} hat den Stich sicher, aber du hast nichts, was sich zum Schmieren lohnt (hohe Trümpfe nie verschmieren!) – die billigste Karte reicht.`};
    }
    const sw=winners.filter(safe);
    if(sw.length&&pts>=10){const c=cheapestWin(sw);return{c,why:`Dein Partner liegt vorne, kann aber noch überstochen werden. Mit <b>${cname(c)}</b> übernimmst du den Stich sicher – bei ${pts} Augen lohnt sich das.`}}
    return{c:lowest(L,hand),why:`Dein Partner ${NAMES[w.seat]} liegt vorne, kann aber noch überstochen werden – deshalb nichts Wertvolles riskieren, sondern wenig Augen zugeben.`};
  }
  if(winners.length){
    const sw=winners.filter(safe);
    if(sw.length){const c=cheapestWin(sw);return{c,why:after===0?`Als Letzter kannst du gefahrlos stechen – nimm die billigste Karte, die reicht (<b>${cname(c)}</b>). Das bringt ${pts+PTS[c.r]} Augen.`:`<b>${cname(c)}</b> kann von den Nachfolgenden nicht mehr überstochen werden – Stich sichern (${pts+PTS[c.r]} Augen).`}}
    if(pts>=10||seat===g.declarer){const c=winners.slice().sort((a,b)=>power(b,lc,g)-power(a,lc,g))[0];return{c,why:`Im Stich liegen schon ${pts} Augen – hoch stechen (<b>${cname(c)}</b>), damit ${rel==='unknown'?'ihn nicht womöglich':'ihn nicht'} der Gegner bekommt.`}}
    return{c:lowest(L,hand),why:`Im Stich sind erst ${pts} Augen und dein Stechen wäre nicht sicher – hohe Karten sparen und wenig zugeben.`};
  }
  const c=lowest(L,hand);
  return{c,why:rel==='unknown'?`Du kannst nicht stechen und weißt noch nicht, ob ${NAMES[w.seat]} zu dir gehört – lieber wenig Augen geben (<b>${cname(c)}</b>: ${PTS[c.r]}).`:`Du kannst nicht stechen – gib dem Gegner so wenige Augen wie möglich (<b>${cname(c)}</b>: ${PTS[c.r]}). Nie dem Gegner schmieren!`};
}

// ---------- Reizen / Handbewertung ----------
const TV={EO:3.5,GO:3,HO:2.5,SO:2.5,EU:2,GU:2,HU:1.8,SU:1.8};
function normStrength(hand,ts){
  let s=0,n=0,o=0,u=0,aces=0;const it=[];
  const tl=tList({type:'solo',suit:ts});
  for(const c of hand.slice().sort((a,b)=>tl.indexOf(a.id)-tl.indexOf(b.id)))if(c.r==='O'||c.r==='U'||c.s===ts){n++;const v=TV[c.id]||(c.r==='A'?1.4:c.r==='10'?1.3:1);s+=v;it.push([cname(c),v]);if(c.r==='O')o++;if(c.r==='U')u++}
  for(const su of SUITS){if(su===ts)continue;const cs=hand.filter(c=>c.s===su&&c.r!=='O'&&c.r!=='U');
    if(cs.some(c=>c.r==='A')){s+=1.5;aces++;it.push([SUITNAME[su]+'-Sau',1.5]);if(cs.some(c=>c.r==='10')){s+=.5;it.push(['Zehn zur '+SUITNAME[su]+'-Sau',.5])}}
    if(!cs.length&&n>=5){s+=.5;it.push([SUITNAME[su]+' frei',.5])}}
  return{s,n,o,u,aces,it};
}
function soloOk(st){return(st.n>=6&&st.s>=13.5)||(st.n>=7&&st.s>=11.5)||(st.n>=5&&st.o>=3&&st.s>=14)}
function wenzStrength(hand){
  const W={EU:4,GU:3.5,HU:3,SU:3};let s=0,u=0,aces=0;const it=[];
  for(const id of ['EU','GU','HU','SU'])if(hand.some(c=>c.id===id)){s+=W[id];u++;it.push([cname(CARD[id]),W[id]])}
  for(const su of SUITS){const cs=hand.filter(c=>c.s===su&&c.r!=='U');const hasA=cs.some(c=>c.r==='A'),has10=cs.some(c=>c.r==='10');
    if(hasA){s+=2.5;aces++;it.push([SUITNAME[su]+'-Sau',2.5]);if(has10){s+=1.5;it.push(['Zehn dazu',1.5])}if(has10&&cs.some(c=>c.r==='K')){s+=1;it.push(['König dazu',1])}if(cs.length>=4){s+=cs.length-3;it.push([`${cs.length} ${SUITNAME[su]} (lange Farbe)`,cs.length-3])}}
    else if(has10){s+=.3;it.push([SUITNAME[su]+'-Zehn ohne Sau',.3])}}
  return{s,u,aces,eu:hand.some(c=>c.id==='EU'),it};
}
const fmt=v=>(Math.round(v*10)/10).toString().replace('.',',');
function breakdown(it,total,need){return it.map(([l,v])=>`${l} <b>${fmt(v)}</b>`).join(' + ')+` = <b>${fmt(total)}</b> (nötig ≈ ${need})`}
function evalHand(hand){
  const sp=normStrength(hand,'H');
  const callable=['E','G','S'].filter(su=>hand.some(c=>c.s===su&&!['O','U','A'].includes(c.r))&&!hand.some(c=>c.id===su+'A'));
  const cnt=su=>hand.filter(c=>c.s===su&&c.r!=='O'&&c.r!=='U').length;
  callable.sort((a,b)=>cnt(a)-cnt(b));
  const sau={ok:callable.length>0&&sp.n>=4&&sp.s>=9,score:sp.s-9,suit:callable[0],st:sp,callable};
  let solo=null;
  for(const su of SUITS){const st=normStrength(hand,su);const ok=soloOk(st);const o={ok,score:st.s-13.5,suit:su,st};const key=x=>(x.ok?1000:0)+x.st.n*20+x.st.s;if(!solo||key(o)>key(solo))solo=o}
  const ws=wenzStrength(hand);
  const wenz={ok:ws.u>=2&&(ws.eu||ws.u>=3)&&ws.s>=15,score:ws.s-15,st:ws};
  let best=null;
  if(solo.ok||wenz.ok)best=(solo.ok&&(!wenz.ok||solo.score>=wenz.score))?{type:'solo',suit:solo.suit,rank:2}:{type:'wenz',rank:2};
  else if(sau.ok)best={type:'sau',suit:sau.suit,rank:1};
  return{sau,solo,wenz,best};
}
function bidAdvice(hand,curRank){
  const e=evalHand(hand);const L=[];
  const yes='<span class="ok">✔</span>',no='<span class="no">✘</span>';
  const sp=e.sau.st;
  L.push(`${e.sau.ok?yes:no} <b>Sauspiel</b> (mind. 4 Trümpfe): ${breakdown(sp.it,sp.s,'9')}. ${!e.sau.callable.length?'<br><i>Du kannst keine Sau rufen – dir fehlt eine Farbe, in der du eine Karte, aber nicht die Sau hast.</i>':`<br><i>Rufen würdest du die ${SUITNAME[e.sau.suit]}-Sau – dort hast du am wenigsten Karten, so wirst du schnell frei.</i>`}`);
  const so=e.solo.st;
  L.push(`${e.solo.ok?yes:no} <b>${SUITNAME[e.solo.suit]}-Solo</b> (mind. 6 Trümpfe): ${breakdown(so.it,so.s,'13,5')}.`);
  const ws=e.wenz.st;
  L.push(`${e.wenz.ok?yes:no} <b>Wenz</b> (mind. 2 Unter inkl. Eichel-Unter): ${ws.it.length?breakdown(ws.it,ws.s,'15'):'keine Unter, keine Sau = 0'}.`);
  let rec;
  if(!e.best||e.best.rank<=curRank)rec=e.best&&e.best.rank<=curRank?'Faustregel: Dein bestes Spiel reicht nicht, um das angesagte zu überbieten – <b>weiter</b>.':'Faustregel: zu schwach für ein eigenes Spiel – <b>weiter</b>.';
  else rec=`Faustregel: <b>${e.best.type==='sau'?'Sauspiel auf die '+SUITNAME[e.best.suit]+'-Sau':e.best.type==='wenz'?'Wenz':SUITNAME[e.best.suit]+'-Solo'}</b>.`;
  return{e,html:`<div class="eval"><b>1. Faustregel-Punkte</b> (so rechnest du am Tisch):<br>${L.join('<br>')}<br>${rec}</div>`};
}

// ---------- Simulation (Monte Carlo) ----------
let WID=0,UNM={k:null,v:null};
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function cloneG(g){return Object.assign({},g,{_id:++WID,hands:g.hands.map(h=>h.slice()),trick:g.trick.slice(),tricks:g.tricks.slice(),played:new Set(g.played),won:g.won.slice(),tw:g.tw.slice(),voids:g.voids.map(v=>new Set(v))})}
function playedBy(g,s){const r=[];for(const t of g.tricks)for(const x of t.cards)if(x.seat===s)r.push(x.card);for(const x of g.trick)if(x.seat===s)r.push(x.card);return r}
function plausibleDecl(g,hand){const e=evalHand(hand);if(g.type==='sau')return e.sau.ok&&e.sau.callable.includes(g.suit);if(g.type==='wenz')return e.wenz.ok;return soloOk(normStrength(hand,g.suit))}
function simApply(c,seat){
  const h=G.hands[seat];h.splice(h.findIndex(x=>x.id===c.id),1);
  if(G.type==='sau'&&!G.trick.length&&!isTr(c,G)&&c.s===G.suit){G.calledLed=true;if(seat===G.partner&&c.r!=='A'){G.ranAway=true;G.aceRevealed=true}}
  if(G.type==='sau'&&c.id===G.suit+'A')G.aceRevealed=true;
  if(G.trick.length){const lc=cat(G.trick[0].card,G);if(cat(c,G)!==lc)G.voids[seat].add(lc)}
  G.trick.push({seat,card:c});G.played.add(c.id);
  if(G.trick.length===4){const w=winner(G.trick,G),p=trickPts(G.trick);G.won[w.seat]+=p;G.tw[w.seat]++;G.tricks.push({cards:G.trick,winner:w.seat,pts:p});G.trick=[];G.turn=w.seat}
  else G.turn=(seat+1)%4;
}
function rollout(){while(G.hands.some(h=>h.length)){const r=choose(G.turn);simApply(r.c,G.turn)}}
// Verteilt die Karten, die "me" nicht kennt, passend zu allem, was man weiß:
// gespielte Karten, wer in welcher Farbe frei ist, wo die Rufsau sein kann, und dass der Spieler sein Spiel auch ansagen konnte.
function dealUnknown(me,ignoreVoids){
  const g=G,others=[0,1,2,3].filter(s=>s!==me),cap={},out={};
  for(const s of others){cap[s]=g.hands[s].length;out[s]=[]}
  let rest=shuffle(unseen(me).slice());
  const okFor=(s,c)=>cap[s]>0&&(ignoreVoids||!g.voids[s].has(cat(c,g)));
  if(g.type==='sau'&&me!==g.partner){const aid=g.suit+'A';const ace=rest.find(c=>c.id===aid);
    if(ace){let h=g.aceRevealed?g.partner:null;
      if(h===null){const el=others.filter(s=>s!==g.declarer&&okFor(s,ace));if(!el.length)return null;h=el[Math.floor(Math.random()*el.length)]}
      out[h].push(ace);cap[h]--;rest=rest.filter(c=>c!==ace)}}
  const dec=g.declarer,wd=dec===me?1:g.type==='sau'?1.7:2.6;
  rest.sort((a,b)=>(isTr(b,g)?1:0)-(isTr(a,g)?1:0));
  for(const c of rest){const el=others.filter(s=>okFor(s,c));if(!el.length)return null;
    let tot=0;const ws=el.map(s=>{const w=cap[s]*(s===dec&&isTr(c,g)?wd:1);tot+=w;return w});
    let r=Math.random()*tot,i=0;while(r>ws[i]&&i<el.length-1){r-=ws[i];i++}
    out[el[i]].push(c);cap[el[i]]--}
  return out;
}
function sampleWorld(me){
  let last=null;
  for(let k=0;k<40;k++){
    const d=dealUnknown(me,k===39);if(!d)continue;
    const w=cloneG(G);for(const s in d)w.hands[s]=d[s];
    if(w.type==='sau'&&!w.aceRevealed&&me!==w.partner)w.partner=w.hands.findIndex(h=>h.some(c=>c.id===w.suit+'A'));
    w.initial=[0,1,2,3].map(s=>w.hands[s].concat(playedBy(w,s)));
    last=w;
    if(w.declarer===me||plausibleDecl(w,w.initial[w.declarer]))return w;
  }
  return last;
}
function computeResult(){
  const g=G;
  const P=[0,1,2,3].filter(s=>team(s)==='P'),O=[0,1,2,3].filter(s=>team(s)==='O');
  const ptsP=P.reduce((a,s)=>a+g.won[s],0),ptsO=120-ptsP;
  const trP=P.reduce((a,s)=>a+g.tw[s],0),trO=8-trP;
  const win=ptsP>=61;
  const losePts=win?ptsO:ptsP,loseTr=win?trO:trP;
  const schneider=losePts<=30,schwarz=loseTr===0;
  const tl=tList(g);const holder=id=>g.initial.findIndex(h=>h.some(c=>c.id===id));
  const t0=team(holder(tl[0]));let run=0;while(run<tl.length&&team(holder(tl[run]))===t0)run++;
  const lauf=run>=(g.type==='wenz'?2:3)?run:0;
  const base=g.type==='sau'?10:50;
  const tarif=base+(schneider?10:0)+(schwarz?10:0)+lauf*10;
  const delta=[0,0,0,0];
  if(g.type==='sau'){for(const s of P)delta[s]=win?tarif:-tarif;for(const s of O)delta[s]=win?-tarif:tarif}
  else{delta[g.declarer]=(win?3:-3)*tarif;for(const s of O)delta[s]=win?-tarif:tarif}
  const mine=team(ME)==='P';
  return{P,O,ptsP,ptsO,win,schneider,schwarz,run,lauf,base,tarif,delta,laufTeam:t0,myPts:mine?ptsP:ptsO,myWin:mine===win};
}
// --- Analyse deines Zugs ---
function afterSeats(seat){const n=3-G.trick.length,a=[];for(let i=1;i<=n;i++)a.push((seat+i)%4);return a}
function explainIllegal(c){
  const t=G.trick;
  if(G.type==='sau'&&c.id===G.suit+'A')return `Die Rufsau darfst du nicht abwerfen („schmieren“) – sie muss gespielt werden, wenn ${SUITNAME[G.suit]} angespielt wird (Ausnahme: letzter Stich).`;
  if(!t.length)return `Solange du die Rufsau hast (und weniger als 4 ${SUITNAME[G.suit]}-Karten), darfst du ${SUITNAME[G.suit]} nur mit der Sau selbst anspielen.`;
  const lc=cat(t[0].card,G);
  if(G.type==='sau'&&lc===G.suit&&G.hands[ME].some(x=>x.id===G.suit+'A'))return `${SUITNAME[G.suit]} wurde angespielt und du hast die Rufsau – du musst sie zugeben.`;
  return lc==='T'?'Es wurde Trumpf gespielt – du musst Trumpf zugeben (Trumpfzwang).':`Es wurde ${SUITNAME[lc]} angespielt – du musst die Farbe bedienen (Farbzwang). Achtung: Ober${G.type==='wenz'?'':' und Unter'} zählen als Trumpf, nicht als Farbe!`;
}

// ---------- Trainer-Analyse für Sitz ME ----------
function describeCard(c){
  const t=G.trick,hand=G.hands[ME];
  const leftInSuit=!isTr(c,G)?hand.filter(x=>x.id!==c.id&&!isTr(x,G)&&x.s===c.s).length:-1;
  const frei=leftInSuit===0?` Außerdem wirst du damit in ${SUITNAME[c.s]} frei und kannst diese Farbe später stechen.`:'';
  if(!t.length){
    if(isTr(c,G)){const out=unseen(ME).filter(x=>isTr(x,G));const top=out.every(x=>tVal(x,G)<tVal(c,G));
      return top?`<b>${cname(c)}</b> ist der höchste Trumpf, der noch im Spiel ist – ein sicherer Stich, und die anderen müssen Trumpf zugeben.`:`Mit <b>${cname(c)}</b> spielst du Trumpf an und lockst die Trümpfe der anderen heraus.`}
    if(G.type==='sau'&&c.s===G.suit&&c.r!=='A')return `Mit <b>${cname(c)}</b> spielst du auf die Rufsau – der Partner muss sich zeigen.`+frei;
    if(c.r==='A')return `<b>${cname(c)}</b> holt jetzt ${PTS.A} Augen und mehr, solange in ${SUITNAME[c.s]} noch keiner sticht.`;
    return `<b>${cname(c)}</b> gibt kaum Augen her und lässt die anderen zeigen, was sie haben.`+frei;
  }
  const lc=cat(t[0].card,G),w=winner(t,G),rel=relation(ME,w.seat),pts=trickPts(t);
  if(power(c,lc,G)>power(w.card,lc,G))return beatenBy(c,lc,ME)?`<b>${cname(c)}</b> sticht (${pts+PTS[c.r]} Augen) – kann aber noch überstochen werden; das Risiko lohnt sich hier.`:`<b>${cname(c)}</b> holt den Stich sicher – ${pts+PTS[c.r]} Augen für deine Partei.`;
  if(rel==='friend')return PTS[c.r]>=10?`<b>${cname(c)}</b> schmiert ${PTS[c.r]} Augen zu deinem Partner.`:`<b>${cname(c)}</b> gibt ${PTS[c.r]} Augen zu deinem Partner und hält Wertvolles zurück.`+frei;
  return `<b>${cname(c)}</b> gibt ${rel==='foe'?'dem Gegner':'diesem Stich'} nur ${PTS[c.r]} Augen.`+frei;
}
function situation(){
  const L=[],un=unseen(ME),outT=un.filter(c=>isTr(c,G)).sort((a,b)=>tVal(b,G)-tVal(a,G));
  const lab=s=>{const r=relation(ME,s);return NAMES[s]+(s===G.declarer?' (Spieler)':r==='friend'?' (Partner)':r==='foe'?' (Gegner)':' (?)')};
  if(G.trick.length){const lc=cat(G.trick[0].card,G),w=winner(G.trick,G),rel=relation(ME,w.seat);
    L.push(`Im Stich: <b>${trickPts(G.trick)} Augen</b>. Vorne: ${lab(w.seat)} mit ${cname(w.card)}${rel==='friend'?' – dein Partner':''}.`);
    const af=afterSeats(ME);L.push(af.length?`Nach dir: ${af.map(lab).join(', ')}.`:'Du bist Letzter – du siehst den ganzen Stich.');
    if(lc!=='T'){const r=un.filter(c=>cat(c,G)===lc);L.push(`${SUITNAME[lc]} noch draußen: ${r.length?r.map(c=>c.r).join(', '):'keine mehr'}.`)}}
  else L.push(`Du spielst aus. ${G.tricks.length?'Bisher angespielt: '+G.tricks.map(t=>{const c=t.cards[0].card;return isTr(c,G)?'Trumpf':SUITNAME[c.s]}).join(', ')+'.':''}`);
  L.push(`Trümpfe draußen: <b>${outT.length}</b>${outT.length?' – höchster: '+cname(outT[0]):''}.`);
  const v=[];for(let s=0;s<4;s++){if(s===ME)continue;const vs=[...G.voids[s]];if(vs.length)v.push(`${NAMES[s]} hat ${vs.map(x=>x==='T'?'keinen Trumpf':'kein '+SUITNAME[x]).join(' und ')} mehr`)}
  if(v.length)L.push(v.join('; ')+'.');
  return L.join('<br>');
}
function analyze(){
  const me=ME,L=legal(G.hands[me],G),heur=choose(me),sit=situation();
  if(L.length===1)return{forced:true,best:L[0].id,why:heur.why,sit};
  const target=Math.max(40,Math.min(140,Math.floor(900/L.length)));
  const stats=L.map(c=>({c,ev:0,win:0,pts:0}));let valid=0;const real=G;
  for(let n=0;n<target;n++){
    const w=sampleWorld(me);if(!w)continue;
    try{for(const st of stats){G=cloneG(w);simApply(st.c,me);rollout();const r=computeResult();st.ev+=r.delta[me];st.win+=r.myWin?1:0;st.pts+=r.myPts}valid++}
    finally{G=real}
  }
  const nn=Math.max(1,valid);
  const ranked=stats.map(s=>({c:s.c,ev:s.ev/nn,win:s.win/nn*100,pts:s.pts/nn})).sort((a,b)=>b.ev-a.ev||b.pts-a.pts);
  let best=ranked[0],why;
  const h=ranked.find(r=>r.c.id===heur.c.id);
  const tol=(G.type==='sau'?10:50)*.03+.15;
  if(best.c.id===heur.c.id||best.ev-h.ev<=tol){best=h;why=heur.why}
  else why=`${describeCard(best.c)} Die Faustregel würde ${cname(heur.c)} spielen, aber in den durchgerechneten Verteilungen gewinnt deine Partei damit nur in <b>${Math.round(h.win)} %</b> statt <b>${Math.round(best.win)} %</b> der Fälle (Ø ${Math.round(h.pts)} statt ${Math.round(best.pts)} Augen).`;
  const desc={};for(const r of ranked)desc[r.c.id]=describeCard(r.c);
  return{forced:false,best:best.c.id,why,sit,valid,tol,desc,ranked:ranked.map(r=>({id:r.c.id,ev:r.ev,win:r.win,pts:r.pts}))};
}
const optName=o=>o.type==='sau'?`Sauspiel ${SUITNAME[o.suit]}`:o.type==='wenz'?'Wenz':`${SUITNAME[o.suit]}-Solo`;
function bidTipHTML(curRank){
  const me=ME,hand=G.hands[me],e=evalHand(hand),adv=bidAdvice(hand,curRank),opts=[];
  if(curRank<1)for(const su of e.sau.callable)opts.push({o:{type:'sau',suit:su},ev:0,win:0});
  if(curRank<2){opts.push({o:{type:'wenz'},ev:0,win:0});for(const su of SUITS)opts.push({o:{type:'solo',suit:su},ev:0,win:0})}
  if(!opts.length)return adv.html;
  const mine=new Set(hand.map(c=>c.id)),restC=Object.values(CARD).filter(c=>!mine.has(c.id));
  const N=70,real=G;
  for(let n=0;n<N;n++){
    const d=shuffle(restC.slice());const others=[0,1,2,3].filter(s=>s!==me);const hands=[];hands[me]=hand.slice();others.forEach((s,i)=>hands[s]=d.slice(i*8,i*8+8));
    try{for(const x of opts){
      G={hands:hands.map(h=>h.slice()),dealer:real.dealer,trick:[],tricks:[],played:new Set(),won:[0,0,0,0],tw:[0,0,0,0],voids:[0,1,2,3].map(()=>new Set()),type:x.o.type,suit:x.o.suit,declarer:me,partner:-1,aceRevealed:false,calledLed:false,ranAway:false,_id:++WID};
      if(G.type==='sau')G.partner=G.hands.findIndex(h=>h.some(c=>c.id===G.suit+'A'));
      G.initial=G.hands.map(h=>h.slice());G.turn=(real.dealer+1)%4;
      rollout();const r=computeResult();x.ev+=r.delta[me];x.win+=r.myWin?1:0}}
    finally{G=real}
  }
  for(const x of opts){x.ev/=N;x.win=x.win/N*100}opts.sort((a,b)=>b.ev-a.ev);
  const best=opts[0];
  const rows=opts.slice(0,6).map(x=>`<div class="rk${x===best&&x.ev>0?' top':''}"><span>${optName(x.o)}</span><span>${Math.round(x.win)} %</span><span class="${x.ev>=0?'okc':'noc'}">${x.ev>=0?'+':''}${fmt(x.ev)} ct</span></div>`).join('');
  return adv.html+`<div class="eval" style="margin-top:8px"><b>2. Simulation</b> (${N} zufällige Verteilungen, durchgespielt):
  <div class="rk head"><span>Spiel</span><span>Gewinnchance</span><span>Ø Ertrag</span></div>${rows}
  <div style="margin-top:4px">${best.ev>0?`Am meisten bringt <b>${optName(best.o)}</b>. Ein Spiel lohnt sich, wenn der Ø Ertrag positiv ist; mit Sicherheitspolster ab etwa ${best.o.type==='sau'?'60 %':'65–70 %'} Gewinnchance.`:'Kein Spiel bringt im Schnitt Gewinn – sag <b>weiter</b>.'}</div></div>`;
}
function run(g,me,names,fn){const pG=G,pM=ME,pN=NAMES;G=g;ME=me;if(names)NAMES=names;try{return fn()}finally{G=pG;ME=pM;NAMES=pN}}
const nextId=()=>++WID;
module.exports={run,nextId,CARD,SUITS,SUITNAME,PTS,cname,gameName,shuffle,sortHand,legal,choose,evalHand,computeResult,unseen,isTr,cat,winner,trickPts,explainIllegal,analyze,bidTipHTML,situation};
