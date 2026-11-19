// Coordinates describe public landmarks; each trip keeps its own time-slot choices.
const TripScenery = (() => {
  const places = {
    hongkong: ['香港',22.30,114.17,55], tokyo:['東京',35.68,139.76,28],
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
  function nearest(lat,lng,distance){
    let found=null, best=Infinity;
    if(lat==null || lng==null) return null;
    for(const [key,[,y,x,radius]] of Object.entries(places)){
      const km=distance([lat,lng],[y,x]);
      if(km<=radius && km<best){found=key; best=km;}
    }
    return found;
  }
  function planned(trip,now){
    if(!trip || !trip.sceneDays) return null;
    const jp=new Date(now.getTime()+9*3600000);
    const slots=trip.sceneDays[jp.toISOString().slice(0,10)];
    if(!slots) return null;
    const hour=jp.getUTCHours();
    const key=slots[hour<11?0:hour<17?1:2];
    if(!Object.hasOwn(places,key)) return null;
    const [place,lat,lng]=places[key];
    return {lat,lng,place,src:'stop',q:place};
  }
  function condition(wx,night){
    const code=wx.code;
    const falling=wx.snowfall>0 || [71,73,75,77,85,86].includes(code);
    const wet=!falling && (wx.rainNow>0 || (code>=51 && code<=67) || [80,81,82,95,96,99].includes(code));
    const covered=wx.depth>0;
    let image=night?'night':'day';
    if(covered) image=night?'nightcover':'cover';
    else if(falling) image=night?'nightsnow':'snow';
    else if(wet) image=night?'nightrain':'rain';
    return {image, sky:falling?'snow':wet?'rain':'',covered};
  }
  return {places,nearest,planned,condition};
})();
