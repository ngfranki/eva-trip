// Coordinates describe public landmarks; each trip keeps its own time-slot choices.
const TripScenery = (() => {
  const places = {
    hkairport:['香港國際機場',22.308,113.918,5], hongkong: ['香港',22.30,114.17,55], tokyo:['東京',35.68,139.76,28],
    narita:['成田機場',35.772,140.393,9], ueno:['上野',35.716,139.772,2],
    roppongi:['六本木',35.661,139.731,2], ikebukuro:['池袋',35.729,139.719,3],
    farm:['Mother Farm',35.248,139.936,5], haneda:['羽田',35.550,139.785,7],
    obihiro:['帶廣',42.918,143.201,11], tokachi:['十勝',43.23,143.30,65],
    cranes:['阿寒丹頂之里',43.144,144.146,12], kushiro:['釧路',42.982,144.385,18],
    akan:['阿寒湖',43.434,144.095,22], kussharo:['屈斜路湖',43.628,144.347,25],
    marsh:['釧路濕原',43.101,144.477,18], tomamu:['Tomamu',43.064,142.63,20],
    furano:['富良野',43.325,142.354,24], biei:['美瑛',43.55,142.47,20],
    otaru:['小樽',43.20,141.00,15], rusutsu:['留壽都',42.736,140.88,20],
    toya:['洞爺湖',42.56,140.82,20], sapporo:['札幌',43.062,141.354,35],
    moere:['莫埃來沼公園',43.123,141.431,3], chitose:['新千歲機場',42.775,141.692,10]
  };
  const landmarkRadius={ueno:0.7,roppongi:0.55,ikebukuro:0.55,cranes:1.5,marsh:1.8,tomamu:3,toya:7,kushiro:6,moere:1.8,haneda:5};
  function nearest(lat,lng,distance){
    let found=null, best=Infinity;
    if(lat==null || lng==null) return null;
    for(const [key,[,y,x,radius]] of Object.entries(places)){
      const km=distance([lat,lng],[y,x]);
      if(km<=(landmarkRadius[key] || radius) && km<best){found=key; best=km;}
    }
    return found;
  }
  // A place binding is saved with the private trip. Shared artwork contains no trip coordinates.
  function entry(trip,key){
    const stop=trip?.sceneStops?.[key];
    const row=stop || places[key];
    return row && {key,place:row[0],lat:row[1],lng:row[2],q:row[0],src:'stop'};
  }
  function planned(trip,now){
    if(!trip) return null;
    const jp=new Date(now.getTime()+9*3600000);
    const date=jp.toISOString().slice(0,10), minutes=jp.getUTCHours()*60+jp.getUTCMinutes();
    const events=trip.sceneSchedule?.[date];
    if(events){
      const event=events.slice().reverse().find(([start])=>minutes>=start);
      if(event) return entry(trip,event[1]);
    }
    const slots=trip.sceneDays?.[date];
    return slots ? entry(trip,slots[minutes<660?0:minutes<1020?1:2]) : null;
  }
  function resolve(trip,lat,lng,distance,choice,hint,accuracy){
    const nearby=[];
    if(Number.isFinite(lat) && Number.isFinite(lng)){
      for(const [key,[place,y,x]] of Object.entries(trip?.sceneStops || {})){
        if(!SCENE_KEYS.includes(key)) continue;
        const km=distance([lat,lng],[y,x]);
        if(km<=0.22) nearby.push({key,place,km});
      }
    }
    nearby.sort((a,b)=>a.km-b.km);
    const tolerance=Math.max(.06,Math.min(.20,(accuracy||0)/1000));
    const options=nearby.filter(x=>x.km<=nearby[0].km+tolerance);
    const uncertainty=Math.min(.06,Math.max(.005,(accuracy||0)/1000));
    const plannedMatch=options.find(x=>x.key===hint && x.km<=options[0].km+uncertainty);
    const picked=options.find(x=>x.key===choice) || plannedMatch || options[0];
    return {key:picked?.key || nearest(lat,lng,distance) || 'default', options};
  }
  const panels=['dawn','day','dusk','night','partly','overcast','fog','wind','rain','nightrain','freezingrain','sleet','storm','hail','heavysnow','blizzard','snow','nightsnow','cover','nightcover'];
  function condition(wx,night,light){
    let code=wx.code;
    const covered=wx.depth>0;
    if(code==null && wx.label){
      const first=wx.label.split(/時々|一時|のち|の後|後轉|間中|有時/)[0];
      const fallback=[[/雹/,96],[/雷/,95],[/凍雨|着氷/,66],[/大雪|暴雪/,75],[/雪/,71],[/豪雨|大雨/,65],[/雨/,61],[/霧/,45],[/陰|曇|密雲/,3],[/雲/,2],[/晴/,0]];
      const match=fallback.find(([pattern])=>pattern.test(first));
      if(match) code=match[1];
    }
    const snowy=wx.snowfall>0 || [71,73,75,77,85,86].includes(code);
    const rainy=wx.rainNow>0 || (code>=51 && code<=67) || [80,81,82].includes(code);
    const windy=wx.wind>=40 || wx.gust>=60;
    let image, kind;
    if(code===96 || code===99) kind='hail';
    else if(code===95) kind='storm';
    else if([56,57,66,67].includes(code)) kind='freezingrain';
    else if(snowy && windy) kind='blizzard';
    else if(snowy && rainy) kind='sleet';
    else if(code===75 || code===86 || wx.snowfall>=1) kind='heavysnow';
    else if(snowy) kind='snow';
    else if(code===65 || code===82 || wx.rainNow>=7.5) kind='downpour';
    else if(rainy) kind='rain';
    else if(code===45 || code===48 || (wx.visibility!=null && wx.visibility<1000)) kind='fog';
    else if(windy) kind='wind';
    else if(covered) kind='cover';
    else if(code===3) kind='overcast';
    else if(code===2) kind='partly';
    else kind='clear';
    if(kind==='clear') image=night?'night':light==='morning'?'dawn':light==='evening'?'dusk':'day';
    else if(night && ['cover','rain','snow'].includes(kind)) image='night'+kind;
    else image=kind==='downpour'?(night?'nightrain':'rain'):kind;
    return {image,kind,covered,sky:snowy?'snow':rainy?'rain':''};
  }
  const morningKinds=['partly','overcast','fog','wind','rain','downpour','freezingrain','sleet','storm','hail','heavysnow','blizzard','snow','cover'];
  const nightKinds=['partly','overcast','fog','wind','downpour','freezingrain','sleet','storm','hail','heavysnow','blizzard'];
  // First 12 characters of each revised WebP's SHA-256. An absent tile keeps its original atlas panel.
  const tileRevisions={'narita-b1':'506881713572','tokachi-b29':'c19e0db2fa1f'};
  const atlasRevisions={};
  // Each sparse overlay has its original atlas dimensions and lists only the tiles it corrects.
  const overlayRevisions={
    "akan":{"rev":"08afd52883ce","tiles":[4]},
    "akan-b":{"rev":"bc95c0d459c6","tiles":[1,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,22,23,24,25,26,27,28,29]},
    "biei":{"rev":"94eecdf9c82f","tiles":[2,7]},
    "biei-b":{"rev":"ffcf6e73f51e","tiles":[0,1,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,21,22,23,24,25,26,27,28,29]},
    "chitose":{"rev":"2c0921813e0d","tiles":[7]},
    "chitose-b":{"rev":"05e30cbf3f2c","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,26,27,28,29]},
    "cranes":{"rev":"9dbd65e7429f","tiles":[14]},
    "cranes-b":{"rev":"2f2636551e75","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,16,18,19,20,23,24,25,26,27,28]},
    "default":{"rev":"63680098c4db","tiles":[1,7,9,13,16]},
    "default-b":{"rev":"ae52eb4285d4","tiles":[0,1,2,3,4,5,7,8,9,10,12,13,14,15,18,19,20,21,22,23,26,28,29]},
    "farm":{"rev":"2758f42d4239","tiles":[4,7,8,11,13]},
    "farm-b":{"rev":"9d1ff4d9710c","tiles":[0,1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,22,23,25,26,27,28,29]},
    "furano":{"rev":"8d89f832a68d","tiles":[14]},
    "furano-b":{"rev":"a6e769425012","tiles":[1,3,4,5,6,7,8,9,10,11,12,16,17,18,19,21,22,23,24,25,26,27,28]},
    "haneda":{"rev":"627adc008342","tiles":[4,10,12]},
    "haneda-b":{"rev":"883f18b4c55e","tiles":[0,1,2,3,4,5,6,9,10,11,12,13,15,16,17,19,20,21,22,23,24,25,26,29]},
    "hkairport":{"rev":"811bca323825","tiles":[1]},
    "hkairport-b":{"rev":"b2a4acccbe3c","tiles":[1,2,3,4,5,6,7,9,10,11,12,13,14,15,16,18,19,20,22,23,24,25,26,27,28,29]},
    "hongkong":{"rev":"1c5206374d36","tiles":[1,3,13]},
    "hongkong-b":{"rev":"e8f1fba43513","tiles":[0,1,3,4,5,6,7,8,9,10,11,12,13,14,17,18,19,22,24,26,27,28,29]},
    "ikebukuro":{"rev":"3eac653f613a","tiles":[6,7,12,17,18]},
    "ikebukuro-b":{"rev":"868344917d22","tiles":[0,1,2,4,5,6,7,8,9,12,13,14,15,16,17,18,19,20,21,23,24,25,26,27,28,29]},
    "kushiro":{"rev":"ba38cfd09b0c","tiles":[0,3,7,16,18,19]},
    "kushiro-b":{"rev":"1b76507afcc6","tiles":[0,1,2,3,4,6,7,8,9,10,12,13,14,15,17,18,19,20,22,25,26,27,28,29]},
    "kussharo":{"rev":"93c2e99f0902","tiles":[4,7]},
    "kussharo-b":{"rev":"606ad10f2f6d","tiles":[0,1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,23,25,26,27,28,29]},
    "marsh":{"rev":"06ee2357488e","tiles":[4,10]},
    "marsh-b":{"rev":"8904c8b7307d","tiles":[1,2,8,10,12,13,14,15,16,19,20,21,22,23,24,25,26,28,29]},
    "moere":{"rev":"a93c0904ed41","tiles":[1,4,7,14,17]},
    "moere-b":{"rev":"92c39f340e50","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,19,20,21,27]},
    "narita":{"rev":"3c73241781f7","tiles":[12,15]},
    "narita-b":{"rev":"c716756f3c0f","tiles":[0,2,3,4,5,6,7,8,9,10]},
    "obihiro":{"rev":"1c28bd332a3d","tiles":[7,13,18]},
    "otaru":{"rev":"3791dd540955","tiles":[9]},
    "roppongi":{"rev":"ee08e606e29f","tiles":[12]},
    "roppongi-b":{"rev":"75a7100560a8","tiles":[3,6,7,8,10,11,12,13,14,15,20,21,22,23,26,29]},
    "rusutsu":{"rev":"15835914c6d3","tiles":[7,11,13,16,18]},
    "rusutsu-b":{"rev":"90f44fbb19ad","tiles":[4,6,8,19,22,25,27]},
    "sapporo":{"rev":"e925743f436f","tiles":[9]},
    "sapporo-b":{"rev":"f1b40a018760","tiles":[0,5,6,7,8,9,11,13,14,15,17,18,19,21,22,24,25,26,27,28]},
    "spot-027c9d1e1":{"rev":"ffc74a33bb42","tiles":[0,9,16]},
    "spot-027c9d1e1-b":{"rev":"3d33059926cc","tiles":[0,1,2,3,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,25,26,27,29]},
    "spot-06158d8b5":{"rev":"a04051825e6b","tiles":[10,12,13]},
    "spot-06158d8b5-b":{"rev":"d17e3d0b2831","tiles":[1,2,3,4,5,7,8,9,10,12,13,15,16,17,18,19,20,21,22,23,25,26,28,29]},
    "spot-10e7818ff":{"rev":"b81ab9cee190","tiles":[7]},
    "spot-10e7818ff-b":{"rev":"4badf5486baf","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,23,24,25,26,27,28,29]},
    "spot-1163438dd":{"rev":"c88b184958b6","tiles":[0,4,5,6,7,8,9,10,11,12,13,14,15,16]},
    "spot-1163438dd-b":{"rev":"e5d1320756fa","tiles":[0,3,7,10,13,14,17,18,20,22,25,27,28]},
    "spot-147b71db6":{"rev":"416d411bcde1","tiles":[7,9]},
    "spot-147b71db6-b":{"rev":"ab746ec417c7","tiles":[0,1,2,3,4,5,6,8,12,13,14,15,17,18,20,21,25,26,27]},
    "spot-1501f4191":{"rev":"1e405a0f6ecd","tiles":[13]},
    "spot-1501f4191-b":{"rev":"97bed0a75cef","tiles":[22]},
    "spot-1a6f6070c-b":{"rev":"dfcbc2d221ba","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-1d625ae4f":{"rev":"d953b4ddb572","tiles":[13]},
    "spot-1d625ae4f-b":{"rev":"37f003a606e7","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,17,19,21,22,23,25,26,27,28,29]},
    "spot-1f13a90b8":{"rev":"7c6cfdd1cf96","tiles":[0,3,5,7,9,10,13,14,15,16,18,19]},
    "spot-1f13a90b8-b":{"rev":"2d9eb707829d","tiles":[0,1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,21,22,23,25,26,27,28,29]},
    "spot-266ac0336":{"rev":"016e874e488a","tiles":[0,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19]},
    "spot-266ac0336-b":{"rev":"8c9f89513548","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-269608d5a":{"rev":"fe0e7d68ff92","tiles":[2,14]},
    "spot-269608d5a-b":{"rev":"90e6aee6142c","tiles":[1,4,5,6,7,8,9,12,13,15,16,18,19,20,21,22,23,26,27,28]},
    "spot-29d2293a9-b":{"rev":"966422d1d44d","tiles":[3,4,5,6,7,9,10,11,12,13,14,15,16,17,19,20,22,23,24,25,26,28,29]},
    "spot-2e38dcad4":{"rev":"de1a9beaeb6c","tiles":[11,12]},
    "spot-2e38dcad4-b":{"rev":"59e9efd64442","tiles":[0,1,2,5,6,7,9,10,12,14,15,16,17,24,25,27]},
    "spot-31c4556cc":{"rev":"a81956a4427b","tiles":[13,14]},
    "spot-31c4556cc-b":{"rev":"fad5c2f8ad26","tiles":[0,1,2,3,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-330159020-b":{"rev":"27f5305b8a80","tiles":[0,7,8,10,17,22,25,29]},
    "spot-33cad23f7":{"rev":"7e078e457fee","tiles":[7]},
    "spot-33cad23f7-b":{"rev":"07c689f38877","tiles":[0,1,2,3,4,5,6,8,9,11,12,13,14,15,17,20,21,23,24,25,26,27,28,29]},
    "spot-3c6782d38":{"rev":"95e40e1907f0","tiles":[13,14]},
    "spot-3c6782d38-b":{"rev":"25bb671c7c46","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,27,28,29]},
    "spot-3f5a2f8fc":{"rev":"f086f04ef697","tiles":[0,1,2,3,7,13,16,17,18,19]},
    "spot-3f5a2f8fc-b":{"rev":"43c64a968ac4","tiles":[0,1,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-3fb8e59e3":{"rev":"c785d47e5bd2","tiles":[0,3,4,5,6,7,8,10,11,12,14,15,16,19]},
    "spot-3fb8e59e3-b":{"rev":"ca1211645fdc","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,20,21,22,23,25,26,28,29]},
    "spot-41089f741":{"rev":"8e1833296fca","tiles":[10]},
    "spot-41089f741-b":{"rev":"8a60b7fba5e2","tiles":[0,1,2,4,5,8,9,10,11,12,13,14,15,16,17,18,20,21,24,25,26,27,28]},
    "spot-4238daf29":{"rev":"988d0f0b54b1","tiles":[0,2,4,5,6,7,8,9,10,11,12,13,14,15,17,18]},
    "spot-4238daf29-b":{"rev":"9ce5ea3f7159","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-4398c48a7":{"rev":"717ad5046dbd","tiles":[9,11,15]},
    "spot-4398c48a7-b":{"rev":"6b15ccf86570","tiles":[7,8,9,10,12,13,14,15,16,20,21,22,23,24,25,26,27,29]},
    "spot-46fc6bef6":{"rev":"975e8b2c7046","tiles":[7]},
    "spot-46fc6bef6-b":{"rev":"4de673650249","tiles":[0,1,2,3,5,13,14,15,16,17,18,19,20,21,22,23,24,28]},
    "spot-4732296ba":{"rev":"b50dbc725b27","tiles":[12,13]},
    "spot-4732296ba-b":{"rev":"b16c604e6326","tiles":[27,29]},
    "spot-48ff7da1d":{"rev":"f0f8e3cc0129","tiles":[4,12]},
    "spot-48ff7da1d-b":{"rev":"6f045bb2eaae","tiles":[1,5,7,9,11,13]},
    "spot-495afce62":{"rev":"8199c54fe843","tiles":[14]},
    "spot-495afce62-b":{"rev":"2cf1bea1101b","tiles":[16,17,19,20,21,22,23]},
    "spot-49779f027":{"rev":"5e265107b247","tiles":[7,12,14]},
    "spot-51652ebdc":{"rev":"adf2df6853ff","tiles":[9,13]},
    "spot-54f5ce43e":{"rev":"7b3805db985d","tiles":[16]},
    "spot-569b08bba":{"rev":"081b3124469c","tiles":[4,5,7,8,10,12,14]},
    "spot-569b08bba-b":{"rev":"190b189d2cb7","tiles":[0,1,2,3,4,5,6,8,9,10,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-59c3d0ebd":{"rev":"7f8a63b309a1","tiles":[2,9,11,13,17]},
    "spot-5df3b4a31":{"rev":"99a3dba5bf36","tiles":[4]},
    "spot-627afeabe":{"rev":"852212a79865","tiles":[0,3,4,6,7,8,10,11,12,13,14,16,19]},
    "spot-627afeabe-b":{"rev":"83191e3b0fba","tiles":[0,2,3,4,5,6,7,9,10,11,13,14,15,16,17,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-628c4952e":{"rev":"b41c8cc7518c","tiles":[4,6,7,8,9,10,11,12,13,15]},
    "spot-628c4952e-b":{"rev":"bf3233d2cc5e","tiles":[0,1,2,3,4,5,6,7,8,10,12,13,14,16,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-66c6acb84":{"rev":"624503027c3e","tiles":[0,2,4,5,6,7,8,10,12,13,14,16]},
    "spot-66c6acb84-b":{"rev":"be0f0ee42ea6","tiles":[0,1,2,3,4,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-697bbef9b":{"rev":"ffd99d9396d7","tiles":[0,1,2,3,4,5,6,8,9,12,13,16,17,18,19]},
    "spot-697bbef9b-b":{"rev":"ade68f67054d","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-78367cc4f":{"rev":"338311576cd1","tiles":[13,15]},
    "spot-78367cc4f-b":{"rev":"0caceddfac3c","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-7955326ed":{"rev":"ac97bb5fb9e6","tiles":[0,2,3,4,5,6,7,8,10,12,14,15,16,17]},
    "spot-7955326ed-b":{"rev":"e4c4943b54c5","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,20,21,22,23,24,25,26,28,29]},
    "spot-79865f593":{"rev":"68a20e51f5c4","tiles":[0,8,9,12,13,16]},
    "spot-79865f593-b":{"rev":"8522d3815c0f","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-7c1b27ec2":{"rev":"a793d4916773","tiles":[4,7]},
    "spot-7c1b27ec2-b":{"rev":"ae49b1b2941b","tiles":[0,1,2,3,4,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-7fef43934":{"rev":"8d9ca06408b6","tiles":[9,13,18]},
    "spot-7fef43934-b":{"rev":"953d87069e7b","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-83a57353c":{"rev":"e5d2d321ff33","tiles":[7,13]},
    "spot-83a57353c-b":{"rev":"0ff98b814167","tiles":[0,1,2,5,6,7,8,9,10,12,13,14,15,16,18,19,20,21,22,25,26,27,28,29]},
    "spot-86577f3e8":{"rev":"cf23b9d582dc","tiles":[7]},
    "spot-86577f3e8-b":{"rev":"8c66a5d3642d","tiles":[3,7,11,12,29]},
    "spot-86b29bbb2":{"rev":"be6334feaaa8","tiles":[7,13]},
    "spot-86b29bbb2-b":{"rev":"a7dd03db5fd2","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,14,15,16,17,18,19,20,21,22,23,24,26,28,29]},
    "spot-881d1794c":{"rev":"a6f83018e614","tiles":[13]},
    "spot-881d1794c-b":{"rev":"5db911be3a71","tiles":[0,1,2,3,4,5,6,8,12,13,14,15,18,19,21,23,25,26,27]},
    "spot-885eb86b5":{"rev":"c488ce68dc31","tiles":[13]},
    "spot-885eb86b5-b":{"rev":"b66b635072de","tiles":[0,9,14,25]},
    "spot-89ba4f10d":{"rev":"dfea1c50ecc3","tiles":[4,7,12]},
    "spot-89ba4f10d-b":{"rev":"848ec1c5ce1f","tiles":[0,1,2,4,5,7,8,9,11,12,13,15,16,17,19,23,26,27,28]},
    "spot-8f335641b":{"rev":"922d7a63f424","tiles":[7,10,13]},
    "spot-8f335641b-b":{"rev":"f50fd93e80b5","tiles":[3,4,6,10,12,13,18,24,26,27,29]},
    "spot-90e680279":{"rev":"26e33f022d33","tiles":[11]},
    "spot-90e680279-b":{"rev":"9577d7d48e47","tiles":[8,15,21,25,29]},
    "spot-986c13ff5":{"rev":"ce3ac4cbcc9f","tiles":[0,3,7,9,13,16]},
    "spot-986c13ff5-b":{"rev":"0817c94bd73c","tiles":[0,1,3,4,5,6,7,9,10,11,12,13,14,15,16,17,18,19,22,25,27,29]},
    "spot-9f53c40a2-b":{"rev":"de3b75298deb","tiles":[1,3,4,5,6,7,10,12,13,14,15,17,18,19,21,26,27,28,29]},
    "spot-a52910691":{"rev":"9fc6c3b9342b","tiles":[0,3,4,6,7,10,13,14,16,19]},
    "spot-a52910691-b":{"rev":"9338e3d73beb","tiles":[0,1,3,4,5,6,7,8,9,10,11,13,14,16,18,21,22,23,24,25,26,27,28]},
    "spot-a7566ef75":{"rev":"fc4e8d80482b","tiles":[0,3,4,7,8,11,12,13,14,15,16,18,19]},
    "spot-a7566ef75-b":{"rev":"9aea30d100d6","tiles":[0,1,3,4,5,6,7,8,9,10,12,13,14,17,19,23,25,26,28,29]},
    "spot-ac4485fba":{"rev":"20045b428de9","tiles":[7,13]},
    "spot-ac4485fba-b":{"rev":"514d5f65b3af","tiles":[0,1,2,4,5,7,8,12,14,16,19,20,21]},
    "spot-acfec276c-b":{"rev":"51d47d16490d","tiles":[1,2,3,4,5,6,8,9,12,16,18,23,24,29]},
    "spot-b238fe7ba":{"rev":"34e2069181cf","tiles":[5]},
    "spot-b531cf1e9":{"rev":"89fd0a7e4191","tiles":[4,7,9,11,14]},
    "spot-bbf221799":{"rev":"d18150d38f81","tiles":[13]},
    "spot-bbf221799-b":{"rev":"96608f65ce44","tiles":[0,1,3,4,5,6,7,8,9,10,12,13,14,15,17,18,19,20,21,22,23,25,26,27,28,29]},
    "spot-c01dc34a3":{"rev":"07081ae18302","tiles":[7]},
    "spot-c1f3498b7":{"rev":"29ede418659d","tiles":[7,13]},
    "spot-c6a0e8931":{"rev":"b2aaa5008163","tiles":[1,4,8,11,12,17,18]},
    "spot-c6a0e8931-b":{"rev":"480171273723","tiles":[0,1,3,4,6,8,12,13,14,15,19,21,25,26,27,29]},
    "spot-c8601530f":{"rev":"7312cb0824e0","tiles":[5]},
    "spot-cb578c594":{"rev":"1e194ec4407b","tiles":[8,13]},
    "spot-cb578c594-b":{"rev":"724d5e5190b0","tiles":[0,1,2,4,7,9,10,12,13,14,15,16,18,19,22,23,25,26,27,28]},
    "spot-cc31e7e93":{"rev":"8600a27d27de","tiles":[4,5,9,10,12,15]},
    "spot-cc31e7e93-b":{"rev":"08fcb94acf5d","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,16,17,18,19,20,21,22,24,25,26,27,28,29]},
    "spot-ceed47a35":{"rev":"3ae5b499bf04","tiles":[1,7,12,13]},
    "spot-ceed47a35-b":{"rev":"19c65ea938ca","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,19,21,25,27,28,29]},
    "spot-d1c54f9ac":{"rev":"907b79c220e6","tiles":[7,9]},
    "spot-d1c54f9ac-b":{"rev":"2164b89c88b3","tiles":[0,1,2,7,8,10,12,13,14,15,16,18,19,21,23,26,27,28,29]},
    "spot-da027a45c":{"rev":"c8dafd9e73f6","tiles":[7,14]},
    "spot-df94bb662":{"rev":"11f36ffa0d5c","tiles":[6]},
    "spot-df94bb662-b":{"rev":"c585c9dcc8bd","tiles":[8,13,22]},
    "spot-e2a5a2ae7":{"rev":"1a46dbc7af78","tiles":[11]},
    "spot-e2b4a3c27":{"rev":"32222fb0d2bc","tiles":[0,3,5,7,9,10,12,13,15,16,18]},
    "spot-e2b4a3c27-b":{"rev":"557ff2fc1515","tiles":[0,1,2,3,4,5,6,8,9,10,13,14,16,18,19,20,21,25,26,27,28,29]},
    "spot-e3447714a":{"rev":"efe1e24c9597","tiles":[8,11,13]},
    "spot-e3447714a-b":{"rev":"3e336d49a73a","tiles":[2,24]},
    "spot-e4f890e25":{"rev":"02de6256fdd0","tiles":[0,2,3,4,5,6,7,8,9,10,11,12,13,14,16,18,19]},
    "spot-e4f890e25-b":{"rev":"2380bfea87f6","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]},
    "spot-e67324d3f":{"rev":"26c45c1deca1","tiles":[0,7,12,18,19]},
    "spot-e67324d3f-b":{"rev":"22e2ba98c0a8","tiles":[0,1,2,3,4,6,7,8,9,10,12,13,14,15,17,19,20,21,22,25,26,27,28,29]},
    "spot-e72214aac":{"rev":"a29c666aca8b","tiles":[2,3]},
    "spot-e72214aac-b":{"rev":"582d0e4ce66d","tiles":[2,20,25,29]},
    "spot-edb6dfccc":{"rev":"ab5811cddd5c","tiles":[14]},
    "spot-eefebbe06-b":{"rev":"3c7a3eacf1f4","tiles":[16,20,21,24]},
    "spot-efe273a59":{"rev":"474752faafa8","tiles":[9,11,12,13]},
    "spot-efe273a59-b":{"rev":"a7dadce29e22","tiles":[2,3,4,11,12,14,15,18,19,20,23,25,26,28,29]},
    "spot-f029df4f6":{"rev":"ee067dfb9b57","tiles":[4,5,6,8,9,11,12,14,19]},
    "spot-f029df4f6-b":{"rev":"95df10a6b4a3","tiles":[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,17,18,19,20,22,23,24,25,26,27,28,29]},
    "spot-f3cd60482":{"rev":"bdc2aee579fc","tiles":[7,8]},
    "spot-f3cd60482-b":{"rev":"9bdd30d7a97b","tiles":[1,4,8,17,20,24,26,27,28]},
    "spot-f3d63d0ed":{"rev":"b2ee43e2f4b2","tiles":[13]},
    "spot-f3d63d0ed-b":{"rev":"e4e7ce5e75f4","tiles":[0,1,2,3,4,5,6,9,10,12,13,14,17,18,19,21,22,23,24,26,27,28,29]},
    "spot-f7cce1fae":{"rev":"e0842d997b0f","tiles":[4,7,13]},
    "spot-f7cce1fae-b":{"rev":"3d2d21a5bf5c","tiles":[10,11,17,24,25,29]},
    "spot-fb71239cf":{"rev":"7a71719715e9","tiles":[7,8,13]},
    "spot-fb71239cf-b":{"rev":"954ee4ba34aa","tiles":[0,1,5,6,8,9,10,14,15,16,17,19,20,21,23,26]},
    "tokachi":{"rev":"a67b0eb3a3ca","tiles":[1,2,7]},
    "tokachi-b":{"rev":"571d05f510e3","tiles":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28]},
    "tokyo":{"rev":"6da641a43c64","tiles":[7,11]},
    "tomamu":{"rev":"914c9739a3e3","tiles":[4,14]},
    "toya":{"rev":"28205ef6262d","tiles":[7]},
    "toya-b":{"rev":"a6967bcfb3b4","tiles":[0,1,2,3,4,6,9]}
  };
  function atlasPath(stem){
    const rev=atlasRevisions[stem];
    return 'hero/atlas/'+stem+'.webp'+(rev?'?rev='+rev:'');
  }
  function tilePath(stem){
    return 'hero/edits/'+stem+'.webp?rev='+tileRevisions[stem];
  }
  function overlayPath(stem){
    return 'hero/corrections/'+stem+'.webp?rev='+overlayRevisions[stem].rev;
  }
  function offlineArtwork(){
    return Object.keys(tileRevisions).map(tilePath).concat(
      Object.keys(overlayRevisions).map(overlayPath),
      SCENE_KEYS.flatMap(key=>[atlasPath(key),atlasPath(key+'-b')])
    );
  }
  function artwork(key,scene,night,light){
    let tile=-1;
    if(scene.covered && ['rain','downpour'].includes(scene.kind)) tile=night?28:light==='morning'?26:27;
    else if(scene.covered && scene.kind==='snow' && !night && light!=='morning') tile=29;
    else if(night && nightKinds.includes(scene.kind)) tile=14+nightKinds.indexOf(scene.kind);
    else if(!night && light==='morning' && morningKinds.includes(scene.kind)) tile=morningKinds.indexOf(scene.kind);
    else if(scene.kind==='downpour') tile=25;
    const extra=tile>=0;
    if(!extra) tile=panels.indexOf(scene.image);
    const edit=key+(extra?'-b':'-a')+tile;
    if(tileRevisions[edit]) return {path:tilePath(edit),tile,standalone:true};
    const cols=extra?5:4, rows=extra?6:5;
    const stem=key+(extra?'-b':'');
    const art={path:atlasPath(stem),tile,cols,rows,
      x:(tile%cols)/(cols-1)*100,y:Math.floor(tile/cols)/(rows-1)*100};
    if(overlayRevisions[stem]?.tiles.includes(tile)) art.overlay=overlayPath(stem);
    return art;
  }
  return {places,entry,nearest,planned,resolve,panels,condition,artwork,offlineArtwork};
})();
