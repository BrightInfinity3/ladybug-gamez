/* ============================================================
   30 - Animal Sprite Engine
   24 detailed SVG animal portraits with fur/feather textures,
   multi-gradient shading, and rim lights
   ============================================================ */

var SpriteEngine = (function () {
  'use strict';

  var cache = {};

  var SVG_DEFS = {

    bear: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="brFur1" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="#9B7924"/>' +
          '<stop offset="60%" stop-color="#7B5914"/>' +
          '<stop offset="100%" stop-color="#543D0E"/>' +
        '</radialGradient>' +
        '<radialGradient id="brHighlight" cx="40%" cy="25%" r="40%">' +
          '<stop offset="0%" stop-color="rgba(200,170,100,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(200,170,100,0)"/>' +
        '</radialGradient>' +
        '<pattern id="brFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<circle cx="1.5" cy="1.5" r="0.4" fill="rgba(80,50,10,0.06)"/>' +
          '<line x1="0" y1="1" x2="3" y2="2" stroke="rgba(120,90,40,0.04)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<circle cx="50" cy="55" r="40" fill="url(#brFur1)"/>' +
      '<circle cx="50" cy="55" r="40" fill="url(#brFurTex)"/>' +
      '<circle cx="50" cy="55" r="40" fill="url(#brHighlight)"/>' +
      // Ears outer
      '<circle cx="25" cy="25" r="14" fill="#654321"/>' +
      '<circle cx="75" cy="25" r="14" fill="#654321"/>' +
      // Ears inner
      '<circle cx="25" cy="24" r="9" fill="#8B6914"/>' +
      '<circle cx="75" cy="24" r="9" fill="#8B6914"/>' +
      '<circle cx="25" cy="23" r="5" fill="#a08030" opacity="0.4"/>' +
      '<circle cx="75" cy="23" r="5" fill="#a08030" opacity="0.4"/>' +
      // Rim light
      '<path d="M28,22 Q50,10 72,22" fill="none" stroke="rgba(255,220,160,0.25)" stroke-width="1.8" stroke-linecap="round"/>' +
      // Muzzle
      '<ellipse cx="50" cy="62" rx="20" ry="16" fill="#c4a265"/>' +
      '<ellipse cx="50" cy="64" rx="16" ry="12" fill="#d4b878" opacity="0.4"/>' +
      // Eyes
      '<ellipse cx="38" cy="48" rx="6.5" ry="7" fill="white"/>' +
      '<ellipse cx="62" cy="48" rx="6.5" ry="7" fill="white"/>' +
      '<ellipse cx="39" cy="48" rx="3.5" ry="4" fill="#4a3010"/>' +
      '<ellipse cx="63" cy="48" rx="3.5" ry="4" fill="#4a3010"/>' +
      '<ellipse cx="39.5" cy="48.5" rx="2" ry="2.5" fill="#1a1000"/>' +
      '<ellipse cx="63.5" cy="48.5" rx="2" ry="2.5" fill="#1a1000"/>' +
      '<circle cx="40.5" cy="46.5" r="1.3" fill="white"/>' +
      '<circle cx="64.5" cy="46.5" r="1.3" fill="white"/>' +
      '<circle cx="38" cy="49.5" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="62" cy="49.5" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M32,52 Q38,54 44,52" fill="none" stroke="rgba(80,50,20,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,52 Q62,54 68,52" fill="none" stroke="rgba(80,50,20,0.15)" stroke-width="0.5"/>' +
      // Nose
      '<ellipse cx="50" cy="58" rx="6" ry="4" fill="#3d2b1f"/>' +
      '<ellipse cx="49" cy="57" rx="2.5" ry="1.2" fill="rgba(255,255,255,0.12)"/>' +
      // Mouth
      '<path d="M46,64 Q50,68 54,64" fill="none" stroke="#3d2b1f" stroke-width="1.5" stroke-linecap="round"/>' +
    '</svg>',

    cat: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="ctFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#606060"/>' +
          '<stop offset="60%" stop-color="#444"/>' +
          '<stop offset="100%" stop-color="#2a2a2a"/>' +
        '</radialGradient>' +
        '<radialGradient id="ctHighlight" cx="42%" cy="28%" r="35%">' +
          '<stop offset="0%" stop-color="rgba(180,180,180,0.25)"/>' +
          '<stop offset="100%" stop-color="rgba(180,180,180,0)"/>' +
        '</radialGradient>' +
        '<pattern id="ctFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<line x1="0" y1="0" x2="1.5" y2="3" stroke="rgba(100,100,100,0.06)" stroke-width="0.3"/>' +
          '<line x1="1.5" y1="0" x2="3" y2="3" stroke="rgba(200,200,200,0.03)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<circle cx="50" cy="55" r="36" fill="url(#ctFur1)"/>' +
      '<circle cx="50" cy="55" r="36" fill="url(#ctFurTex)"/>' +
      '<circle cx="50" cy="55" r="36" fill="url(#ctHighlight)"/>' +
      // Tabby stripe marks
      '<path d="M38,30 Q42,35 38,40" fill="none" stroke="rgba(80,80,80,0.15)" stroke-width="1.5"/>' +
      '<path d="M62,30 Q58,35 62,40" fill="none" stroke="rgba(80,80,80,0.15)" stroke-width="1.5"/>' +
      '<path d="M50,25 L50,32" fill="none" stroke="rgba(80,80,80,0.12)" stroke-width="1.2"/>' +
      // Ears outer
      '<polygon points="24,34 14,4 40,26" fill="#484848" stroke="#333" stroke-width="0.8"/>' +
      '<polygon points="76,34 86,4 60,26" fill="#484848" stroke="#333" stroke-width="0.8"/>' +
      // Ears inner
      '<polygon points="25,32 18,10 35,24" fill="#d08080" opacity="0.3"/>' +
      '<polygon points="75,32 82,10 65,24" fill="#d08080" opacity="0.3"/>' +
      // Rim light
      '<path d="M30,30 Q50,18 70,30" fill="none" stroke="rgba(220,220,220,0.2)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eyes (large, cat-like)
      '<ellipse cx="36" cy="48" rx="8.5" ry="9" fill="#c8ef50"/>' +
      '<ellipse cx="64" cy="48" rx="8.5" ry="9" fill="#c8ef50"/>' +
      '<ellipse cx="36" cy="48" rx="8" ry="8.5" fill="#bfef4f"/>' +
      '<ellipse cx="64" cy="48" rx="8" ry="8.5" fill="#bfef4f"/>' +
      // Slit pupils
      '<ellipse cx="36" cy="48" rx="2.8" ry="7.5" fill="#111"/>' +
      '<ellipse cx="64" cy="48" rx="2.8" ry="7.5" fill="#111"/>' +
      // Eye highlights
      '<circle cx="34" cy="44.5" r="1.5" fill="rgba(255,255,255,0.7)"/>' +
      '<circle cx="62" cy="44.5" r="1.5" fill="rgba(255,255,255,0.7)"/>' +
      '<circle cx="38" cy="51" r="0.8" fill="rgba(255,255,255,0.3)"/>' +
      '<circle cx="66" cy="51" r="0.8" fill="rgba(255,255,255,0.3)"/>' +
      // Lower eyelid
      '<path d="M28,52 Q36,54 44,52" fill="none" stroke="rgba(80,80,80,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,52 Q64,54 72,52" fill="none" stroke="rgba(80,80,80,0.15)" stroke-width="0.5"/>' +
      // Nose
      '<ellipse cx="50" cy="60" rx="3.5" ry="2.5" fill="#e89898"/>' +
      '<ellipse cx="49.5" cy="59.5" rx="1.2" ry="0.6" fill="rgba(255,255,255,0.15)"/>' +
      // Mouth
      '<path d="M46,63 Q50,67 54,63" fill="none" stroke="#888" stroke-width="1" stroke-linecap="round"/>' +
      // Whiskers
      '<line x1="14" y1="52" x2="33" y2="56" stroke="#777" stroke-width="0.6"/>' +
      '<line x1="14" y1="58" x2="33" y2="58" stroke="#777" stroke-width="0.6"/>' +
      '<line x1="14" y1="64" x2="33" y2="60" stroke="#777" stroke-width="0.6"/>' +
      '<line x1="67" y1="56" x2="86" y2="52" stroke="#777" stroke-width="0.6"/>' +
      '<line x1="67" y1="58" x2="86" y2="58" stroke="#777" stroke-width="0.6"/>' +
      '<line x1="67" y1="60" x2="86" y2="64" stroke="#777" stroke-width="0.6"/>' +
    '</svg>',

    owl: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="owFeat1" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="#9B8365"/>' +
          '<stop offset="60%" stop-color="#7B6345"/>' +
          '<stop offset="100%" stop-color="#4C3023"/>' +
        '</radialGradient>' +
        '<radialGradient id="owHighlight" cx="45%" cy="25%" r="35%">' +
          '<stop offset="0%" stop-color="rgba(200,180,140,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(200,180,140,0)"/>' +
        '</radialGradient>' +
        '<pattern id="owFeathTex" patternUnits="userSpaceOnUse" width="6" height="8">' +
          '<path d="M0,4 Q3,2 6,4 Q3,6 0,4" fill="none" stroke="rgba(100,70,40,0.08)" stroke-width="0.4"/>' +
          '<path d="M3,0 Q6,2 3,4 Q0,2 3,0" fill="none" stroke="rgba(160,130,80,0.05)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<ellipse cx="50" cy="55" rx="36" ry="38" fill="url(#owFeat1)"/>' +
      '<ellipse cx="50" cy="55" rx="36" ry="38" fill="url(#owFeathTex)"/>' +
      '<ellipse cx="50" cy="55" rx="36" ry="38" fill="url(#owHighlight)"/>' +
      // Feather pattern accents
      '<path d="M30,40 Q35,38 30,36" fill="none" stroke="rgba(120,90,50,0.12)" stroke-width="0.8"/>' +
      '<path d="M70,40 Q65,38 70,36" fill="none" stroke="rgba(120,90,50,0.12)" stroke-width="0.8"/>' +
      // Ear tufts
      '<polygon points="28,26 16,8 38,22" fill="#7B5B40"/>' +
      '<polygon points="72,26 84,8 62,22" fill="#7B5B40"/>' +
      '<polygon points="29,25 20,12 36,22" fill="#9B7B55" opacity="0.5"/>' +
      '<polygon points="71,25 80,12 64,22" fill="#9B7B55" opacity="0.5"/>' +
      // Rim light
      '<path d="M30,28 Q50,16 70,28" fill="none" stroke="rgba(255,220,160,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eye discs
      '<circle cx="36" cy="48" r="14" fill="#d4c8a8"/>' +
      '<circle cx="64" cy="48" r="14" fill="#d4c8a8"/>' +
      '<circle cx="36" cy="48" r="12" fill="#e8dcc0" opacity="0.5"/>' +
      '<circle cx="64" cy="48" r="12" fill="#e8dcc0" opacity="0.5"/>' +
      // Eye white
      '<circle cx="36" cy="48" r="10" fill="white"/>' +
      '<circle cx="64" cy="48" r="10" fill="white"/>' +
      // Iris gradient
      '<circle cx="37" cy="48" r="6" fill="#d46800"/>' +
      '<circle cx="65" cy="48" r="6" fill="#d46800"/>' +
      '<circle cx="37" cy="48" r="4.5" fill="#c45a00"/>' +
      '<circle cx="65" cy="48" r="4.5" fill="#c45a00"/>' +
      // Pupil
      '<circle cx="37" cy="48" r="3" fill="#111"/>' +
      '<circle cx="65" cy="48" r="3" fill="#111"/>' +
      // Eye highlights
      '<circle cx="39" cy="46" r="1.8" fill="white"/>' +
      '<circle cx="67" cy="46" r="1.8" fill="white"/>' +
      '<circle cx="36" cy="50" r="0.8" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="64" cy="50" r="0.8" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M27,53 Q36,56 45,53" fill="none" stroke="rgba(100,80,50,0.15)" stroke-width="0.5"/>' +
      '<path d="M55,53 Q64,56 73,53" fill="none" stroke="rgba(100,80,50,0.15)" stroke-width="0.5"/>' +
      // Beak
      '<polygon points="50,56 45,64 55,64" fill="#e8a020"/>' +
      '<polygon points="50,56 47,62 50,60" fill="#f0b830" opacity="0.4"/>' +
      // Breast feathers
      '<ellipse cx="50" cy="72" rx="14" ry="8" fill="#c4a875"/>' +
      '<path d="M40,72 Q44,68 48,72 Q52,68 56,72 Q60,68 62,72" fill="none" stroke="#8B7355" stroke-width="0.8" opacity="0.6"/>' +
      '<path d="M42,76 Q46,72 50,76 Q54,72 58,76" fill="none" stroke="#8B7355" stroke-width="0.6" opacity="0.4"/>' +
    '</svg>',

    penguin: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="pnBody1" cx="50%" cy="45%" r="55%">' +
          '<stop offset="0%" stop-color="#353535"/>' +
          '<stop offset="60%" stop-color="#1e1e1e"/>' +
          '<stop offset="100%" stop-color="#0a0a0a"/>' +
        '</radialGradient>' +
        '<radialGradient id="pnHighlight" cx="40%" cy="25%" r="35%">' +
          '<stop offset="0%" stop-color="rgba(120,120,140,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(120,120,140,0)"/>' +
        '</radialGradient>' +
        '<pattern id="pnFeathTex" patternUnits="userSpaceOnUse" width="4" height="3">' +
          '<ellipse cx="2" cy="1.5" rx="1.5" ry="1" fill="none" stroke="rgba(60,60,70,0.06)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<ellipse cx="50" cy="55" rx="34" ry="40" fill="url(#pnBody1)"/>' +
      '<ellipse cx="50" cy="55" rx="34" ry="40" fill="url(#pnFeathTex)"/>' +
      '<ellipse cx="50" cy="55" rx="34" ry="40" fill="url(#pnHighlight)"/>' +
      // White belly
      '<ellipse cx="50" cy="62" rx="22" ry="28" fill="white"/>' +
      '<ellipse cx="50" cy="60" rx="18" ry="24" fill="#f8f8ff" opacity="0.5"/>' +
      // Rim light
      '<path d="M30,30 Q50,18 70,30" fill="none" stroke="rgba(180,180,220,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eyes
      '<ellipse cx="37" cy="46" rx="7.5" ry="7.5" fill="white"/>' +
      '<ellipse cx="63" cy="46" rx="7.5" ry="7.5" fill="white"/>' +
      '<ellipse cx="38" cy="46" rx="4" ry="4.5" fill="#222"/>' +
      '<ellipse cx="64" cy="46" rx="4" ry="4.5" fill="#222"/>' +
      '<ellipse cx="38.5" cy="46.5" rx="2.5" ry="3" fill="#111"/>' +
      '<ellipse cx="64.5" cy="46.5" rx="2.5" ry="3" fill="#111"/>' +
      '<circle cx="40" cy="44" r="1.5" fill="white"/>' +
      '<circle cx="66" cy="44" r="1.5" fill="white"/>' +
      '<circle cx="37" cy="48" r="0.7" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="63" cy="48" r="0.7" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M30,50 Q37,52 44,50" fill="none" stroke="rgba(60,60,70,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,50 Q63,52 70,50" fill="none" stroke="rgba(60,60,70,0.15)" stroke-width="0.5"/>' +
      // Beak
      '<polygon points="50,52 43,60 57,60" fill="#e88020"/>' +
      '<polygon points="50,52 46,58 50,56" fill="#f0a040" opacity="0.4"/>' +
      // Belly pattern
      '<path d="M40,67 Q44,63 48,66 Q52,63 56,67 Q60,63 62,67" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="0.8"/>' +
    '</svg>',

    raccoon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="rcFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#999"/>' +
          '<stop offset="60%" stop-color="#777"/>' +
          '<stop offset="100%" stop-color="#444"/>' +
        '</radialGradient>' +
        '<radialGradient id="rcHighlight" cx="42%" cy="28%" r="35%">' +
          '<stop offset="0%" stop-color="rgba(200,200,210,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(200,200,210,0)"/>' +
        '</radialGradient>' +
        '<pattern id="rcFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<line x1="0" y1="0" x2="1" y2="3" stroke="rgba(60,60,60,0.06)" stroke-width="0.3"/>' +
          '<line x1="2" y1="0" x2="3" y2="3" stroke="rgba(180,180,180,0.04)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<circle cx="50" cy="55" r="38" fill="url(#rcFur1)"/>' +
      '<circle cx="50" cy="55" r="38" fill="url(#rcFurTex)"/>' +
      '<circle cx="50" cy="55" r="38" fill="url(#rcHighlight)"/>' +
      // Ears outer
      '<circle cx="26" cy="26" r="12" fill="#666"/>' +
      '<circle cx="74" cy="26" r="12" fill="#666"/>' +
      // Ears inner
      '<circle cx="26" cy="25" r="7.5" fill="#999"/>' +
      '<circle cx="74" cy="25" r="7.5" fill="#999"/>' +
      '<circle cx="26" cy="24" r="4" fill="#aaa" opacity="0.3"/>' +
      '<circle cx="74" cy="24" r="4" fill="#aaa" opacity="0.3"/>' +
      // Rim light
      '<path d="M28,28 Q50,14 72,28" fill="none" stroke="rgba(220,220,230,0.2)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Muzzle
      '<ellipse cx="50" cy="60" rx="18" ry="14" fill="#ddd"/>' +
      '<ellipse cx="50" cy="62" rx="14" ry="10" fill="#eee" opacity="0.4"/>' +
      // Bandit mask
      '<path d="M22,40 Q36,34 44,48 Q36,56 22,50 Z" fill="#1a1a1a"/>' +
      '<path d="M78,40 Q64,34 56,48 Q64,56 78,50 Z" fill="#1a1a1a"/>' +
      // Mask highlight
      '<path d="M24,42 Q34,36 42,46" fill="none" stroke="rgba(100,100,110,0.25)" stroke-width="1" stroke-linecap="round"/>' +
      '<path d="M76,42 Q66,36 58,46" fill="none" stroke="rgba(100,100,110,0.25)" stroke-width="1" stroke-linecap="round"/>' +
      // Eyes
      '<ellipse cx="34" cy="47" rx="6.5" ry="7" fill="white"/>' +
      '<ellipse cx="66" cy="47" rx="6.5" ry="7" fill="white"/>' +
      '<ellipse cx="35" cy="47" rx="3.5" ry="4" fill="#333"/>' +
      '<ellipse cx="67" cy="47" rx="3.5" ry="4" fill="#333"/>' +
      '<ellipse cx="35.5" cy="47.5" rx="2" ry="2.5" fill="#111"/>' +
      '<ellipse cx="67.5" cy="47.5" rx="2" ry="2.5" fill="#111"/>' +
      '<circle cx="36.5" cy="45.5" r="1.3" fill="white"/>' +
      '<circle cx="68.5" cy="45.5" r="1.3" fill="white"/>' +
      '<circle cx="34" cy="49" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="66" cy="49" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M28,51 Q34,53 40,51" fill="none" stroke="rgba(60,60,60,0.15)" stroke-width="0.5"/>' +
      '<path d="M60,51 Q66,53 72,51" fill="none" stroke="rgba(60,60,60,0.15)" stroke-width="0.5"/>' +
      // Nose
      '<ellipse cx="50" cy="58" rx="4.5" ry="3.2" fill="#222"/>' +
      '<ellipse cx="49.5" cy="57.5" rx="1.5" ry="0.8" fill="rgba(255,255,255,0.1)"/>' +
      // Nose bridge line
      '<path d="M50,60 L50,63" fill="none" stroke="#555" stroke-width="0.8"/>' +
      // Mouth
      '<path d="M46,63 Q50,67 54,63" fill="none" stroke="#666" stroke-width="1.2" stroke-linecap="round"/>' +
    '</svg>',

    frog: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="frSkin1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#5CBF60"/>' +
          '<stop offset="60%" stop-color="#3EA842"/>' +
          '<stop offset="100%" stop-color="#267028"/>' +
        '</radialGradient>' +
        '<radialGradient id="frHighlight" cx="45%" cy="30%" r="35%">' +
          '<stop offset="0%" stop-color="rgba(150,230,150,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(150,230,150,0)"/>' +
        '</radialGradient>' +
        '<pattern id="frSkinTex" patternUnits="userSpaceOnUse" width="8" height="8">' +
          '<circle cx="4" cy="4" r="2" fill="none" stroke="rgba(30,100,30,0.06)" stroke-width="0.4"/>' +
          '<circle cx="0" cy="0" r="1.5" fill="none" stroke="rgba(80,180,80,0.04)" stroke-width="0.3"/>' +
          '<circle cx="8" cy="8" r="1.5" fill="none" stroke="rgba(80,180,80,0.04)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<ellipse cx="50" cy="58" rx="38" ry="34" fill="url(#frSkin1)"/>' +
      '<ellipse cx="50" cy="58" rx="38" ry="34" fill="url(#frSkinTex)"/>' +
      '<ellipse cx="50" cy="58" rx="38" ry="34" fill="url(#frHighlight)"/>' +
      // Spots
      '<circle cx="35" cy="44" r="5" fill="#4CAF50" opacity="0.15"/>' +
      '<circle cx="65" cy="44" r="5" fill="#4CAF50" opacity="0.15"/>' +
      '<circle cx="42" cy="68" r="4" fill="#4CAF50" opacity="0.12"/>' +
      '<circle cx="58" cy="68" r="4" fill="#4CAF50" opacity="0.12"/>' +
      // Eye bulges
      '<circle cx="32" cy="32" r="15" fill="#3EA842"/>' +
      '<circle cx="68" cy="32" r="15" fill="#3EA842"/>' +
      '<circle cx="32" cy="31" r="13" fill="#4CB84E" opacity="0.5"/>' +
      '<circle cx="68" cy="31" r="13" fill="#4CB84E" opacity="0.5"/>' +
      // Rim light
      '<path d="M22,38 Q50,20 78,38" fill="none" stroke="rgba(180,255,180,0.2)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eye white
      '<circle cx="32" cy="31" r="11" fill="white"/>' +
      '<circle cx="68" cy="31" r="11" fill="white"/>' +
      // Iris
      '<circle cx="33" cy="31" r="6" fill="#2E8B30"/>' +
      '<circle cx="69" cy="31" r="6" fill="#2E8B30"/>' +
      '<circle cx="33" cy="31" r="4.5" fill="#1a6020"/>' +
      '<circle cx="69" cy="31" r="4.5" fill="#1a6020"/>' +
      // Pupil
      '<circle cx="33.5" cy="31" r="3" fill="#111"/>' +
      '<circle cx="69.5" cy="31" r="3" fill="#111"/>' +
      // Eye highlights
      '<circle cx="35.5" cy="29" r="2.2" fill="white"/>' +
      '<circle cx="71.5" cy="29" r="2.2" fill="white"/>' +
      '<circle cx="32" cy="33" r="0.9" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="68" cy="33" r="0.9" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M22,36 Q32,39 42,36" fill="none" stroke="rgba(30,100,30,0.15)" stroke-width="0.5"/>' +
      '<path d="M58,36 Q68,39 78,36" fill="none" stroke="rgba(30,100,30,0.15)" stroke-width="0.5"/>' +
      // Belly
      '<ellipse cx="50" cy="60" rx="28" ry="20" fill="#76C87A"/>' +
      '<ellipse cx="50" cy="58" rx="22" ry="16" fill="#88D48C" opacity="0.3"/>' +
      // Nostril dots
      '<circle cx="44" cy="47" r="1" fill="#2E7D32" opacity="0.3"/>' +
      '<circle cx="56" cy="47" r="1" fill="#2E7D32" opacity="0.3"/>' +
      // Mouth
      '<path d="M28,62 Q50,80 72,62" fill="none" stroke="#2E7D32" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>',

    // ---- NEW ANIMALS ----

    dog: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="dgFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#D4A54A"/>' +
          '<stop offset="60%" stop-color="#B8862D"/>' +
          '<stop offset="100%" stop-color="#8B6518"/>' +
        '</radialGradient>' +
        '<radialGradient id="dgHighlight" cx="40%" cy="28%" r="40%">' +
          '<stop offset="0%" stop-color="rgba(240,210,140,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(240,210,140,0)"/>' +
        '</radialGradient>' +
        '<pattern id="dgFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<line x1="0" y1="0" x2="1.5" y2="3" stroke="rgba(120,80,20,0.06)" stroke-width="0.3"/>' +
          '<line x1="1.5" y1="0" x2="3" y2="3" stroke="rgba(220,180,100,0.04)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<circle cx="50" cy="55" r="38" fill="url(#dgFur1)"/>' +
      '<circle cx="50" cy="55" r="38" fill="url(#dgFurTex)"/>' +
      '<circle cx="50" cy="55" r="38" fill="url(#dgHighlight)"/>' +
      // Floppy ears (drooping down to sides)
      '<ellipse cx="22" cy="42" rx="14" ry="22" fill="#A07020" transform="rotate(15, 22, 42)"/>' +
      '<ellipse cx="78" cy="42" rx="14" ry="22" fill="#A07020" transform="rotate(-15, 78, 42)"/>' +
      // Ear inner
      '<ellipse cx="23" cy="44" rx="9" ry="16" fill="#C49840" transform="rotate(15, 23, 44)" opacity="0.5"/>' +
      '<ellipse cx="77" cy="44" rx="9" ry="16" fill="#C49840" transform="rotate(-15, 77, 44)" opacity="0.5"/>' +
      // Rim light
      '<path d="M28,28 Q50,16 72,28" fill="none" stroke="rgba(255,220,140,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Muzzle
      '<ellipse cx="50" cy="62" rx="20" ry="16" fill="#E8C880"/>' +
      '<ellipse cx="50" cy="64" rx="16" ry="12" fill="#F0D898" opacity="0.4"/>' +
      // Eyes
      '<ellipse cx="37" cy="47" rx="7" ry="7.5" fill="white"/>' +
      '<ellipse cx="63" cy="47" rx="7" ry="7.5" fill="white"/>' +
      '<ellipse cx="38" cy="47" rx="4" ry="4.5" fill="#6B4226"/>' +
      '<ellipse cx="64" cy="47" rx="4" ry="4.5" fill="#6B4226"/>' +
      '<ellipse cx="38.5" cy="47.5" rx="2.5" ry="3" fill="#3d2010"/>' +
      '<ellipse cx="64.5" cy="47.5" rx="2.5" ry="3" fill="#3d2010"/>' +
      // Eye highlights
      '<circle cx="40" cy="45" r="1.5" fill="white"/>' +
      '<circle cx="66" cy="45" r="1.5" fill="white"/>' +
      '<circle cx="37" cy="49" r="0.7" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="63" cy="49" r="0.7" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M31,51 Q37,53 43,51" fill="none" stroke="rgba(140,90,30,0.15)" stroke-width="0.5"/>' +
      '<path d="M57,51 Q63,53 69,51" fill="none" stroke="rgba(140,90,30,0.15)" stroke-width="0.5"/>' +
      // Nose
      '<ellipse cx="50" cy="58" rx="5.5" ry="4" fill="#222"/>' +
      '<ellipse cx="49" cy="57" rx="2" ry="1" fill="rgba(255,255,255,0.12)"/>' +
      // Mouth
      '<path d="M45,63 Q50,68 55,63" fill="none" stroke="#3d2010" stroke-width="1.5" stroke-linecap="round"/>' +
    '</svg>',

    panda: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="pdFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#F5F5F0"/>' +
          '<stop offset="60%" stop-color="#E8E8E0"/>' +
          '<stop offset="100%" stop-color="#D0D0C8"/>' +
        '</radialGradient>' +
        '<radialGradient id="pdHighlight" cx="42%" cy="28%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(255,255,255,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(255,255,255,0)"/>' +
        '</radialGradient>' +
        '<pattern id="pdFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<line x1="0" y1="0" x2="1" y2="3" stroke="rgba(180,180,170,0.05)" stroke-width="0.3"/>' +
          '<line x1="2" y1="0" x2="3" y2="3" stroke="rgba(220,220,210,0.04)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<circle cx="50" cy="55" r="38" fill="url(#pdFur1)"/>' +
      '<circle cx="50" cy="55" r="38" fill="url(#pdFurTex)"/>' +
      '<circle cx="50" cy="55" r="38" fill="url(#pdHighlight)"/>' +
      // Ears (solid black, round)
      '<circle cx="24" cy="26" r="13" fill="#1a1a1a"/>' +
      '<circle cx="76" cy="26" r="13" fill="#1a1a1a"/>' +
      // Rim light
      '<path d="M28,26 Q50,14 72,26" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Black eye patches
      '<ellipse cx="36" cy="48" rx="12" ry="11" fill="#1a1a1a" transform="rotate(-8, 36, 48)"/>' +
      '<ellipse cx="64" cy="48" rx="12" ry="11" fill="#1a1a1a" transform="rotate(8, 64, 48)"/>' +
      // Eyes
      '<ellipse cx="36" cy="48" rx="6" ry="6.5" fill="white"/>' +
      '<ellipse cx="64" cy="48" rx="6" ry="6.5" fill="white"/>' +
      '<ellipse cx="37" cy="48" rx="3.5" ry="4" fill="#222"/>' +
      '<ellipse cx="65" cy="48" rx="3.5" ry="4" fill="#222"/>' +
      '<ellipse cx="37.5" cy="48.5" rx="2" ry="2.5" fill="#111"/>' +
      '<ellipse cx="65.5" cy="48.5" rx="2" ry="2.5" fill="#111"/>' +
      // Eye highlights
      '<circle cx="39" cy="46.5" r="1.3" fill="white"/>' +
      '<circle cx="67" cy="46.5" r="1.3" fill="white"/>' +
      '<circle cx="36" cy="50" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="64" cy="50" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M31,52 Q36,54 41,52" fill="none" stroke="rgba(40,40,40,0.2)" stroke-width="0.5"/>' +
      '<path d="M59,52 Q64,54 69,52" fill="none" stroke="rgba(40,40,40,0.2)" stroke-width="0.5"/>' +
      // Nose
      '<ellipse cx="50" cy="60" rx="4" ry="3" fill="#222"/>' +
      '<ellipse cx="49.5" cy="59.5" rx="1.5" ry="0.7" fill="rgba(255,255,255,0.1)"/>' +
      // Mouth
      '<path d="M46,63 Q50,67 54,63" fill="none" stroke="#444" stroke-width="1.2" stroke-linecap="round"/>' +
    '</svg>',

    monkey: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="mkFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#A0764E"/>' +
          '<stop offset="60%" stop-color="#805A38"/>' +
          '<stop offset="100%" stop-color="#5C3D22"/>' +
        '</radialGradient>' +
        '<radialGradient id="mkHighlight" cx="42%" cy="28%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(200,160,100,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(200,160,100,0)"/>' +
        '</radialGradient>' +
        '<pattern id="mkFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<line x1="0" y1="0" x2="1.5" y2="3" stroke="rgba(80,50,20,0.06)" stroke-width="0.3"/>' +
          '<line x1="1.5" y1="0" x2="3" y2="3" stroke="rgba(180,140,80,0.04)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<circle cx="50" cy="55" r="36" fill="url(#mkFur1)"/>' +
      '<circle cx="50" cy="55" r="36" fill="url(#mkFurTex)"/>' +
      '<circle cx="50" cy="55" r="36" fill="url(#mkHighlight)"/>' +
      // Ears (large, round, sticking out)
      '<circle cx="16" cy="42" r="13" fill="#805A38"/>' +
      '<circle cx="84" cy="42" r="13" fill="#805A38"/>' +
      // Ear inner
      '<circle cx="17" cy="42" r="8.5" fill="#E8C8A0"/>' +
      '<circle cx="83" cy="42" r="8.5" fill="#E8C8A0"/>' +
      '<circle cx="17" cy="41" r="5" fill="#D4B088" opacity="0.4"/>' +
      '<circle cx="83" cy="41" r="5" fill="#D4B088" opacity="0.4"/>' +
      // Rim light
      '<path d="M28,28 Q50,16 72,28" fill="none" stroke="rgba(220,180,120,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Face/muzzle area (larger peach oval)
      '<ellipse cx="50" cy="58" rx="24" ry="22" fill="#E8C8A0"/>' +
      '<ellipse cx="50" cy="60" rx="20" ry="18" fill="#F0D4B0" opacity="0.4"/>' +
      // Eyes
      '<ellipse cx="38" cy="46" rx="6.5" ry="7" fill="white"/>' +
      '<ellipse cx="62" cy="46" rx="6.5" ry="7" fill="white"/>' +
      '<ellipse cx="39" cy="46" rx="3.5" ry="4" fill="#4A2810"/>' +
      '<ellipse cx="63" cy="46" rx="3.5" ry="4" fill="#4A2810"/>' +
      '<ellipse cx="39.5" cy="46.5" rx="2" ry="2.5" fill="#2A1808"/>' +
      '<ellipse cx="63.5" cy="46.5" rx="2" ry="2.5" fill="#2A1808"/>' +
      // Eye highlights
      '<circle cx="40.5" cy="44.5" r="1.3" fill="white"/>' +
      '<circle cx="64.5" cy="44.5" r="1.3" fill="white"/>' +
      '<circle cx="38" cy="48" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="62" cy="48" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M32,50 Q38,52 44,50" fill="none" stroke="rgba(100,70,30,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,50 Q62,52 68,50" fill="none" stroke="rgba(100,70,30,0.15)" stroke-width="0.5"/>' +
      // Nose
      '<ellipse cx="50" cy="58" rx="4" ry="2.8" fill="#5C3D22"/>' +
      '<ellipse cx="49.5" cy="57.5" rx="1.5" ry="0.7" fill="rgba(255,255,255,0.12)"/>' +
      // Mouth (wide, curved)
      '<path d="M42,63 Q50,69 58,63" fill="none" stroke="#5C3D22" stroke-width="1.5" stroke-linecap="round"/>' +
    '</svg>',

    deer: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="drFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#C49664"/>' +
          '<stop offset="60%" stop-color="#A87848"/>' +
          '<stop offset="100%" stop-color="#7C5430"/>' +
        '</radialGradient>' +
        '<radialGradient id="drHighlight" cx="42%" cy="28%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(220,180,130,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(220,180,130,0)"/>' +
        '</radialGradient>' +
        '<pattern id="drFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<line x1="0" y1="0" x2="1.5" y2="3" stroke="rgba(100,60,20,0.06)" stroke-width="0.3"/>' +
          '<line x1="1.5" y1="0" x2="3" y2="3" stroke="rgba(200,160,100,0.04)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Antlers (behind head)
      '<path d="M34,22 L30,8 L26,14 M30,8 L34,2" fill="none" stroke="#8B6914" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M66,22 L70,8 L74,14 M70,8 L66,2" fill="none" stroke="#8B6914" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      // Body (gentle oval)
      '<ellipse cx="50" cy="55" rx="34" ry="36" fill="url(#drFur1)"/>' +
      '<ellipse cx="50" cy="55" rx="34" ry="36" fill="url(#drFurTex)"/>' +
      '<ellipse cx="50" cy="55" rx="34" ry="36" fill="url(#drHighlight)"/>' +
      // Ears (tall, rounded ovals)
      '<ellipse cx="24" cy="30" rx="8" ry="14" fill="#A87848" transform="rotate(-12, 24, 30)"/>' +
      '<ellipse cx="76" cy="30" rx="8" ry="14" fill="#A87848" transform="rotate(12, 76, 30)"/>' +
      // Ear inner
      '<ellipse cx="25" cy="30" rx="5" ry="10" fill="#D4A878" transform="rotate(-12, 25, 30)" opacity="0.5"/>' +
      '<ellipse cx="75" cy="30" rx="5" ry="10" fill="#D4A878" transform="rotate(12, 75, 30)" opacity="0.5"/>' +
      // Rim light
      '<path d="M30,28 Q50,16 70,28" fill="none" stroke="rgba(240,210,160,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Forehead spots
      '<circle cx="46" cy="36" r="1.5" fill="white" opacity="0.2"/>' +
      '<circle cx="54" cy="36" r="1.5" fill="white" opacity="0.2"/>' +
      '<circle cx="50" cy="33" r="1.8" fill="white" opacity="0.25"/>' +
      // Muzzle
      '<ellipse cx="50" cy="62" rx="16" ry="14" fill="#D8B888"/>' +
      '<ellipse cx="50" cy="64" rx="12" ry="10" fill="#E4C898" opacity="0.4"/>' +
      // Eyes (large, gentle)
      '<ellipse cx="37" cy="46" rx="8" ry="8.5" fill="white"/>' +
      '<ellipse cx="63" cy="46" rx="8" ry="8.5" fill="white"/>' +
      '<ellipse cx="38" cy="46" rx="4.5" ry="5" fill="#5C3D22"/>' +
      '<ellipse cx="64" cy="46" rx="4.5" ry="5" fill="#5C3D22"/>' +
      '<ellipse cx="38.5" cy="46.5" rx="2.5" ry="3" fill="#2d1b00"/>' +
      '<ellipse cx="64.5" cy="46.5" rx="2.5" ry="3" fill="#2d1b00"/>' +
      // Eye highlights
      '<circle cx="40" cy="44.5" r="1.8" fill="white"/>' +
      '<circle cx="66" cy="44.5" r="1.8" fill="white"/>' +
      '<circle cx="37" cy="48.5" r="0.8" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="63" cy="48.5" r="0.8" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M30,50 Q37,52.5 44,50" fill="none" stroke="rgba(120,80,30,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,50 Q63,52.5 70,50" fill="none" stroke="rgba(120,80,30,0.15)" stroke-width="0.5"/>' +
      // Nose
      '<ellipse cx="50" cy="59" rx="4" ry="2.8" fill="#3d2010"/>' +
      '<ellipse cx="49.5" cy="58.5" rx="1.5" ry="0.7" fill="rgba(255,255,255,0.12)"/>' +
      // Mouth
      '<path d="M46,63 Q50,67 54,63" fill="none" stroke="#5C3D22" stroke-width="1.2" stroke-linecap="round"/>' +
    '</svg>',

    // ---- WAVE 2 NEW ANIMALS ----

    hedgehog: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="hhBody" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#C8A070"/>' +
          '<stop offset="60%" stop-color="#A07848"/>' +
          '<stop offset="100%" stop-color="#705028"/>' +
        '</radialGradient>' +
        '<radialGradient id="hhBelly" cx="50%" cy="60%" r="45%">' +
          '<stop offset="0%" stop-color="#F0DCC0"/>' +
          '<stop offset="100%" stop-color="#D8C0A0"/>' +
        '</radialGradient>' +
        '<radialGradient id="hhShine" cx="42%" cy="28%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(220,200,160,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(220,200,160,0)"/>' +
        '</radialGradient>' +
        '<pattern id="hhTex" patternUnits="userSpaceOnUse" width="4" height="4">' +
          '<circle cx="2" cy="2" r="0.5" fill="rgba(90,60,30,0.06)"/>' +
          '<line x1="0" y1="3" x2="4" y2="3.5" stroke="rgba(120,80,40,0.04)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Spines (drawn behind body — radiating spiky crown)
      // Top row
      '<line x1="50" y1="18" x2="50" y2="6" stroke="#5A3A1A" stroke-width="2.5" stroke-linecap="round"/>' +
      '<line x1="42" y1="20" x2="38" y2="8" stroke="#5A3A1A" stroke-width="2.5" stroke-linecap="round"/>' +
      '<line x1="58" y1="20" x2="62" y2="8" stroke="#5A3A1A" stroke-width="2.5" stroke-linecap="round"/>' +
      '<line x1="34" y1="24" x2="26" y2="12" stroke="#5A3A1A" stroke-width="2.3" stroke-linecap="round"/>' +
      '<line x1="66" y1="24" x2="74" y2="12" stroke="#5A3A1A" stroke-width="2.3" stroke-linecap="round"/>' +
      // Upper side spines
      '<line x1="26" y1="32" x2="14" y2="20" stroke="#6B4A28" stroke-width="2.2" stroke-linecap="round"/>' +
      '<line x1="74" y1="32" x2="86" y2="20" stroke="#6B4A28" stroke-width="2.2" stroke-linecap="round"/>' +
      '<line x1="20" y1="40" x2="6" y2="30" stroke="#6B4A28" stroke-width="2" stroke-linecap="round"/>' +
      '<line x1="80" y1="40" x2="94" y2="30" stroke="#6B4A28" stroke-width="2" stroke-linecap="round"/>' +
      // Mid side spines
      '<line x1="18" y1="50" x2="4" y2="44" stroke="#7B5A30" stroke-width="1.8" stroke-linecap="round"/>' +
      '<line x1="82" y1="50" x2="96" y2="44" stroke="#7B5A30" stroke-width="1.8" stroke-linecap="round"/>' +
      // Lighter spine highlights (interleaved)
      '<line x1="46" y1="19" x2="44" y2="10" stroke="#8B6A38" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="54" y1="19" x2="56" y2="10" stroke="#8B6A38" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="30" y1="28" x2="20" y2="16" stroke="#8B6A38" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="70" y1="28" x2="80" y2="16" stroke="#8B6A38" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="22" y1="45" x2="8" y2="38" stroke="#8B6A38" stroke-width="1.3" stroke-linecap="round"/>' +
      '<line x1="78" y1="45" x2="92" y2="38" stroke="#8B6A38" stroke-width="1.3" stroke-linecap="round"/>' +
      // Body (main shape)
      '<ellipse cx="50" cy="55" rx="34" ry="32" fill="url(#hhBody)"/>' +
      '<ellipse cx="50" cy="55" rx="34" ry="32" fill="url(#hhTex)"/>' +
      '<ellipse cx="50" cy="55" rx="34" ry="32" fill="url(#hhShine)"/>' +
      // Belly (lighter oval on face/chest area)
      '<ellipse cx="50" cy="62" rx="22" ry="20" fill="url(#hhBelly)"/>' +
      // Rim light
      '<path d="M28,32 Q50,22 72,32" fill="none" stroke="rgba(255,230,180,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Ears (small rounded)
      '<ellipse cx="32" cy="38" rx="6" ry="7" fill="#A07848"/>' +
      '<ellipse cx="68" cy="38" rx="6" ry="7" fill="#A07848"/>' +
      '<ellipse cx="32" cy="38" rx="4" ry="5" fill="#D8A878" opacity="0.5"/>' +
      '<ellipse cx="68" cy="38" rx="4" ry="5" fill="#D8A878" opacity="0.5"/>' +
      // Eyes (big and round)
      '<ellipse cx="38" cy="52" rx="7" ry="7.5" fill="white"/>' +
      '<ellipse cx="62" cy="52" rx="7" ry="7.5" fill="white"/>' +
      // Iris (dark chocolate brown)
      '<ellipse cx="38.5" cy="52.5" rx="4.5" ry="5" fill="#3A2510"/>' +
      '<ellipse cx="62.5" cy="52.5" rx="4.5" ry="5" fill="#3A2510"/>' +
      // Pupils
      '<ellipse cx="39" cy="53" rx="2.2" ry="2.8" fill="#1a0e05"/>' +
      '<ellipse cx="63" cy="53" rx="2.2" ry="2.8" fill="#1a0e05"/>' +
      // Eye highlights
      '<circle cx="40.5" cy="50" r="1.8" fill="white"/>' +
      '<circle cx="64.5" cy="50" r="1.8" fill="white"/>' +
      '<circle cx="37" cy="55" r="0.7" fill="rgba(255,255,255,0.35)"/>' +
      '<circle cx="61" cy="55" r="0.7" fill="rgba(255,255,255,0.35)"/>' +
      // Lower eyelid
      '<path d="M32,56 Q38,58 44,56" fill="none" stroke="rgba(120,80,40,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,56 Q62,58 68,56" fill="none" stroke="rgba(120,80,40,0.15)" stroke-width="0.5"/>' +
      // Nose (prominent black button nose)
      '<ellipse cx="50" cy="62" rx="4.5" ry="3.5" fill="#2a1a0a"/>' +
      '<ellipse cx="49" cy="61" rx="1.5" ry="0.8" fill="rgba(255,255,255,0.2)"/>' +
      // Mouth (cute smile)
      '<path d="M44,67 Q47,71 50,69 Q53,71 56,67" fill="none" stroke="#705028" stroke-width="1.2" stroke-linecap="round"/>' +
      // Cheek blush
      '<ellipse cx="30" cy="58" rx="4" ry="2.5" fill="rgba(220,140,120,0.2)"/>' +
      '<ellipse cx="70" cy="58" rx="4" ry="2.5" fill="rgba(220,140,120,0.2)"/>' +
      // Tiny feet at bottom
      '<ellipse cx="38" cy="84" rx="5" ry="3" fill="#8B6840"/>' +
      '<ellipse cx="62" cy="84" rx="5" ry="3" fill="#8B6840"/>' +
    '</svg>',

    shark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="dlFur1" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="#5A6A7A"/>' +
          '<stop offset="60%" stop-color="#3A4A5A"/>' +
          '<stop offset="100%" stop-color="#1A2A3A"/>' +
        '</radialGradient>' +
        '<radialGradient id="dlHighlight" cx="42%" cy="28%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(120,140,160,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(120,140,160,0)"/>' +
        '</radialGradient>' +
        '<pattern id="dlFurTex" patternUnits="userSpaceOnUse" width="4" height="4">' +
          '<line x1="0" y1="2" x2="4" y2="2.5" stroke="rgba(20,30,40,0.06)" stroke-width="0.3"/>' +
          '<line x1="0" y1="0" x2="4" y2="0.5" stroke="rgba(80,100,120,0.04)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Body (aggressive sleek shape)
      '<ellipse cx="50" cy="56" rx="36" ry="30" fill="url(#dlFur1)"/>' +
      '<ellipse cx="50" cy="56" rx="36" ry="30" fill="url(#dlFurTex)"/>' +
      '<ellipse cx="50" cy="56" rx="36" ry="30" fill="url(#dlHighlight)"/>' +
      // Lighter underbelly
      '<ellipse cx="50" cy="68" rx="26" ry="14" fill="#8A9AA8" opacity="0.5"/>' +
      '<ellipse cx="50" cy="70" rx="20" ry="10" fill="#A0B0BE" opacity="0.3"/>' +
      // Dorsal fin (large, prominent, triangular)
      '<path d="M50,18 L42,40 L58,40 Z" fill="#2A3A4A"/>' +
      '<path d="M50,18 L46,34 L50,30" fill="#3A4A5A" opacity="0.4"/>' +
      '<path d="M50,18 L54,34 L50,30" fill="#1A2A3A" opacity="0.3"/>' +
      // Pectoral fins (sides)
      '<path d="M22,62 Q12,72 8,80 Q14,74 24,66" fill="#2A3A4A"/>' +
      '<path d="M78,62 Q88,72 92,80 Q86,74 76,66" fill="#2A3A4A"/>' +
      // Gill slits (left side)
      '<line x1="28" y1="52" x2="30" y2="56" stroke="#1A2A3A" stroke-width="1" stroke-linecap="round" opacity="0.5"/>' +
      '<line x1="31" y1="51" x2="33" y2="55" stroke="#1A2A3A" stroke-width="1" stroke-linecap="round" opacity="0.5"/>' +
      '<line x1="34" y1="50" x2="36" y2="54" stroke="#1A2A3A" stroke-width="1" stroke-linecap="round" opacity="0.5"/>' +
      // Gill slits (right side)
      '<line x1="72" y1="52" x2="70" y2="56" stroke="#1A2A3A" stroke-width="1" stroke-linecap="round" opacity="0.5"/>' +
      '<line x1="69" y1="51" x2="67" y2="55" stroke="#1A2A3A" stroke-width="1" stroke-linecap="round" opacity="0.5"/>' +
      '<line x1="66" y1="50" x2="64" y2="54" stroke="#1A2A3A" stroke-width="1" stroke-linecap="round" opacity="0.5"/>' +
      // Snout (angular, no beak)
      '<path d="M38,58 Q32,58 24,60 Q28,54 38,54" fill="#4A5A6A"/>' +
      // Rim light
      '<path d="M30,34 Q50,22 70,34" fill="none" stroke="rgba(160,180,200,0.2)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Mouth with teeth
      '<path d="M28,64 Q40,70 50,68 Q60,70 72,64" fill="none" stroke="#1A2A3A" stroke-width="1.8" stroke-linecap="round"/>' +
      // Upper teeth (jagged white triangles)
      '<polygon points="32,64 34,68 36,64" fill="white" opacity="0.85"/>' +
      '<polygon points="38,65 40,69 42,65" fill="white" opacity="0.85"/>' +
      '<polygon points="44,66 46,70 48,66" fill="white" opacity="0.85"/>' +
      '<polygon points="52,66 54,70 56,66" fill="white" opacity="0.85"/>' +
      '<polygon points="58,65 60,69 62,65" fill="white" opacity="0.85"/>' +
      '<polygon points="64,64 66,68 68,64" fill="white" opacity="0.85"/>' +
      // Eyes (small, intense)
      '<ellipse cx="36" cy="50" rx="4.5" ry="5" fill="white"/>' +
      '<ellipse cx="64" cy="50" rx="4.5" ry="5" fill="white"/>' +
      '<ellipse cx="36.5" cy="50" rx="2.5" ry="3" fill="#1A2A3A"/>' +
      '<ellipse cx="64.5" cy="50" rx="2.5" ry="3" fill="#1A2A3A"/>' +
      '<ellipse cx="37" cy="50.5" rx="1.4" ry="1.8" fill="#0A0A0A"/>' +
      '<ellipse cx="65" cy="50.5" rx="1.4" ry="1.8" fill="#0A0A0A"/>' +
      // Eye highlights
      '<circle cx="38" cy="49" r="1" fill="white"/>' +
      '<circle cx="66" cy="49" r="1" fill="white"/>' +
      '<circle cx="35.5" cy="51.5" r="0.5" fill="rgba(255,255,255,0.35)"/>' +
      '<circle cx="63.5" cy="51.5" r="0.5" fill="rgba(255,255,255,0.35)"/>' +
      // Lower eyelid
      '<path d="M32,54 Q36,55.5 40,54" fill="none" stroke="rgba(20,30,40,0.2)" stroke-width="0.5"/>' +
      '<path d="M60,54 Q64,55.5 68,54" fill="none" stroke="rgba(20,30,40,0.2)" stroke-width="0.5"/>' +
    '</svg>',

    octopus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="ocFur1" cx="50%" cy="45%" r="50%">' +
          '<stop offset="0%" stop-color="#B868A8"/>' +
          '<stop offset="60%" stop-color="#985888"/>' +
          '<stop offset="100%" stop-color="#784070"/>' +
        '</radialGradient>' +
        '<radialGradient id="ocHighlight" cx="42%" cy="25%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(220,160,210,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(220,160,210,0)"/>' +
        '</radialGradient>' +
        '<pattern id="ocFurTex" patternUnits="userSpaceOnUse" width="5" height="5">' +
          '<circle cx="2.5" cy="2.5" r="1" fill="none" stroke="rgba(100,40,90,0.06)" stroke-width="0.4"/>' +
          '<circle cx="0" cy="0" r="0.6" fill="rgba(160,80,150,0.04)"/>' +
        '</pattern>' +
      '</defs>' +
      // 8 Tentacles — uniform, evenly spaced, all hanging down with gentle S-curves
      '<path d="M20,66 Q14,78 18,90 Q20,96 16,98" fill="none" stroke="#885078" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M28,72 Q24,82 26,92 Q28,98 24,100" fill="none" stroke="#885078" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M37,76 Q34,86 36,94 Q37,98 34,100" fill="none" stroke="#885078" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M44,78 Q42,88 44,96 Q44,100 42,100" fill="none" stroke="#885078" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M56,78 Q58,88 56,96 Q56,100 58,100" fill="none" stroke="#885078" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M63,76 Q66,86 64,94 Q63,98 66,100" fill="none" stroke="#885078" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M72,72 Q76,82 74,92 Q72,98 76,100" fill="none" stroke="#885078" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M80,66 Q86,78 82,90 Q80,96 84,98" fill="none" stroke="#885078" stroke-width="4" stroke-linecap="round"/>' +
      // Sucker dots (2 per tentacle)
      '<circle cx="16" cy="82" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="18" cy="92" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="25" cy="84" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="26" cy="94" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="35" cy="88" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="36" cy="96" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="43" cy="90" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="44" cy="98" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="57" cy="90" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="56" cy="98" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="65" cy="88" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="64" cy="96" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="75" cy="84" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="74" cy="94" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="84" cy="82" r="1" fill="#A06898" opacity="0.5"/>' +
      '<circle cx="82" cy="92" r="1" fill="#A06898" opacity="0.5"/>' +
      // Head (large bulbous mantle)
      '<ellipse cx="50" cy="44" rx="34" ry="36" fill="url(#ocFur1)"/>' +
      '<ellipse cx="50" cy="44" rx="34" ry="36" fill="url(#ocFurTex)"/>' +
      '<ellipse cx="50" cy="44" rx="34" ry="36" fill="url(#ocHighlight)"/>' +
      // Spots on head
      '<circle cx="36" cy="30" r="3" fill="#A06898" opacity="0.15"/>' +
      '<circle cx="62" cy="28" r="3.5" fill="#A06898" opacity="0.12"/>' +
      '<circle cx="50" cy="24" r="2.5" fill="#A06898" opacity="0.1"/>' +
      '<circle cx="42" cy="22" r="2" fill="#C080B0" opacity="0.1"/>' +
      '<circle cx="58" cy="34" r="2" fill="#C080B0" opacity="0.1"/>' +
      // Rim light
      '<path d="M28,22 Q50,10 72,22" fill="none" stroke="rgba(240,180,230,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eyes (large, expressive)
      '<ellipse cx="36" cy="44" rx="8" ry="9" fill="white"/>' +
      '<ellipse cx="64" cy="44" rx="8" ry="9" fill="white"/>' +
      '<ellipse cx="37" cy="44" rx="4.5" ry="5.5" fill="#4A2060"/>' +
      '<ellipse cx="65" cy="44" rx="4.5" ry="5.5" fill="#4A2060"/>' +
      '<ellipse cx="37.5" cy="44.5" rx="2.5" ry="3.2" fill="#2A1040"/>' +
      '<ellipse cx="65.5" cy="44.5" rx="2.5" ry="3.2" fill="#2A1040"/>' +
      // Eye highlights
      '<circle cx="39" cy="42.5" r="1.8" fill="white"/>' +
      '<circle cx="67" cy="42.5" r="1.8" fill="white"/>' +
      '<circle cx="36" cy="47" r="0.8" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="64" cy="47" r="0.8" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M29,49 Q36,51 43,49" fill="none" stroke="rgba(80,40,70,0.15)" stroke-width="0.5"/>' +
      '<path d="M57,49 Q64,51 71,49" fill="none" stroke="rgba(80,40,70,0.15)" stroke-width="0.5"/>' +
      // Nose (small beak-like)
      '<path d="M48,56 L50,60 L52,56" fill="#5A3050"/>' +
      '<path d="M49,57 L50,58.5" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/>' +
      // Mouth (small beak opening)
      '<path d="M47,61 Q50,64 53,61" fill="none" stroke="#5A3050" stroke-width="1.2" stroke-linecap="round"/>' +
    '</svg>',

    hamster: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="hmFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#E8B878"/>' +
          '<stop offset="60%" stop-color="#D09858"/>' +
          '<stop offset="100%" stop-color="#B07838"/>' +
        '</radialGradient>' +
        '<radialGradient id="hmHighlight" cx="42%" cy="28%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(255,220,170,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(255,220,170,0)"/>' +
        '</radialGradient>' +
        '<pattern id="hmFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<line x1="0" y1="0" x2="1.5" y2="3" stroke="rgba(160,100,40,0.06)" stroke-width="0.3"/>' +
          '<line x1="1.5" y1="0" x2="3" y2="3" stroke="rgba(240,200,140,0.04)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Cheek pouches (behind face, very prominent)
      '<circle cx="22" cy="60" r="18" fill="#E8C090"/>' +
      '<circle cx="78" cy="60" r="18" fill="#E8C090"/>' +
      '<circle cx="23" cy="59" r="14" fill="#F0D0A0" opacity="0.4"/>' +
      '<circle cx="77" cy="59" r="14" fill="#F0D0A0" opacity="0.4"/>' +
      // Body (very round, chubby face)
      '<circle cx="50" cy="55" r="36" fill="url(#hmFur1)"/>' +
      '<circle cx="50" cy="55" r="36" fill="url(#hmFurTex)"/>' +
      '<circle cx="50" cy="55" r="36" fill="url(#hmHighlight)"/>' +
      // White belly/chin area
      '<ellipse cx="50" cy="68" rx="18" ry="12" fill="white" opacity="0.35"/>' +
      // Ears (small, round, on top)
      '<circle cx="30" cy="24" r="10" fill="#C08848"/>' +
      '<circle cx="70" cy="24" r="10" fill="#C08848"/>' +
      // Ear inner
      '<circle cx="30" cy="23" r="6.5" fill="#E8A088"/>' +
      '<circle cx="70" cy="23" r="6.5" fill="#E8A088"/>' +
      '<circle cx="30" cy="22" r="3.5" fill="#F0B8A0" opacity="0.4"/>' +
      '<circle cx="70" cy="22" r="3.5" fill="#F0B8A0" opacity="0.4"/>' +
      // Rim light
      '<path d="M28,28 Q50,16 72,28" fill="none" stroke="rgba(255,220,170,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eyes (small, dark, beady)
      '<ellipse cx="40" cy="50" rx="5" ry="5.5" fill="white"/>' +
      '<ellipse cx="60" cy="50" rx="5" ry="5.5" fill="white"/>' +
      '<ellipse cx="40.5" cy="50" rx="3" ry="3.5" fill="#1a1000"/>' +
      '<ellipse cx="60.5" cy="50" rx="3" ry="3.5" fill="#1a1000"/>' +
      '<ellipse cx="41" cy="50.5" rx="2" ry="2.2" fill="#0a0500"/>' +
      '<ellipse cx="61" cy="50.5" rx="2" ry="2.2" fill="#0a0500"/>' +
      // Eye highlights
      '<circle cx="42" cy="48.5" r="1.2" fill="white"/>' +
      '<circle cx="62" cy="48.5" r="1.2" fill="white"/>' +
      '<circle cx="40" cy="52" r="0.5" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="60" cy="52" r="0.5" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M36,54 Q40,55.5 44,54" fill="none" stroke="rgba(140,90,30,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,54 Q60,55.5 64,54" fill="none" stroke="rgba(140,90,30,0.15)" stroke-width="0.5"/>' +
      // Nose (tiny, pink)
      '<ellipse cx="50" cy="58" rx="3" ry="2.2" fill="#E88888"/>' +
      '<ellipse cx="49.5" cy="57.5" rx="1.2" ry="0.6" fill="rgba(255,255,255,0.2)"/>' +
      // Mouth (tiny)
      '<path d="M47,61 Q50,64 53,61" fill="none" stroke="#B07040" stroke-width="1" stroke-linecap="round"/>' +
      // Whiskers
      '<line x1="12" y1="56" x2="34" y2="58" stroke="#C8A060" stroke-width="0.5"/>' +
      '<line x1="12" y1="60" x2="34" y2="60" stroke="#C8A060" stroke-width="0.5"/>' +
      '<line x1="12" y1="64" x2="34" y2="62" stroke="#C8A060" stroke-width="0.5"/>' +
      '<line x1="66" y1="58" x2="88" y2="56" stroke="#C8A060" stroke-width="0.5"/>' +
      '<line x1="66" y1="60" x2="88" y2="60" stroke="#C8A060" stroke-width="0.5"/>' +
      '<line x1="66" y1="62" x2="88" y2="64" stroke="#C8A060" stroke-width="0.5"/>' +
    '</svg>',

    parrot: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="prFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#50C850"/>' +
          '<stop offset="60%" stop-color="#38A838"/>' +
          '<stop offset="100%" stop-color="#208020"/>' +
        '</radialGradient>' +
        '<radialGradient id="prHighlight" cx="42%" cy="28%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(140,240,140,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(140,240,140,0)"/>' +
        '</radialGradient>' +
        '<pattern id="prFurTex" patternUnits="userSpaceOnUse" width="4" height="6">' +
          '<path d="M0,3 Q2,1.5 4,3" fill="none" stroke="rgba(20,80,20,0.06)" stroke-width="0.4"/>' +
          '<path d="M2,0 Q4,1.5 2,3" fill="none" stroke="rgba(80,200,80,0.04)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<ellipse cx="50" cy="58" rx="34" ry="36" fill="url(#prFur1)"/>' +
      '<ellipse cx="50" cy="58" rx="34" ry="36" fill="url(#prFurTex)"/>' +
      '<ellipse cx="50" cy="58" rx="34" ry="36" fill="url(#prHighlight)"/>' +
      // Colorful forehead/crest area
      '<path d="M30,30 Q40,16 50,18 Q60,16 70,30" fill="#CC3030" opacity="0.7"/>' +
      '<path d="M34,32 Q42,20 50,22 Q58,20 66,32" fill="#E8CC20" opacity="0.5"/>' +
      // Small crest feathers on top
      '<path d="M46,20 Q44,10 48,14" fill="none" stroke="#CC3030" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M50,18 Q50,8 52,12" fill="none" stroke="#E8CC20" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M54,20 Q56,10 52,14" fill="none" stroke="#CC3030" stroke-width="2" stroke-linecap="round"/>' +
      // Feather accents on body
      '<path d="M30,50 Q35,48 30,46" fill="none" stroke="rgba(20,100,20,0.12)" stroke-width="0.8"/>' +
      '<path d="M70,50 Q65,48 70,46" fill="none" stroke="rgba(20,100,20,0.12)" stroke-width="0.8"/>' +
      // Rim light
      '<path d="M30,32 Q50,20 70,32" fill="none" stroke="rgba(180,255,180,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eye rings (parrots have white eye rings)
      '<circle cx="38" cy="44" r="10" fill="white"/>' +
      '<circle cx="62" cy="44" r="10" fill="white"/>' +
      '<circle cx="38" cy="44" r="8" fill="#E8E8E0" opacity="0.3"/>' +
      '<circle cx="62" cy="44" r="8" fill="#E8E8E0" opacity="0.3"/>' +
      // Eye white
      '<circle cx="38" cy="44" r="7" fill="white"/>' +
      '<circle cx="62" cy="44" r="7" fill="white"/>' +
      // Iris
      '<circle cx="38.5" cy="44" rx="4" ry="4.5" fill="#D46800"/>' +
      '<circle cx="62.5" cy="44" rx="4" ry="4.5" fill="#D46800"/>' +
      '<circle cx="39" cy="44" r="3" fill="#AA4400"/>' +
      '<circle cx="63" cy="44" r="3" fill="#AA4400"/>' +
      // Pupil
      '<circle cx="39" cy="44" r="2" fill="#111"/>' +
      '<circle cx="63" cy="44" r="2" fill="#111"/>' +
      // Eye highlights
      '<circle cx="40.5" cy="42.5" r="1.5" fill="white"/>' +
      '<circle cx="64.5" cy="42.5" r="1.5" fill="white"/>' +
      '<circle cx="38" cy="46" r="0.7" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="62" cy="46" r="0.7" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M32,49 Q38,51 44,49" fill="none" stroke="rgba(20,80,20,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,49 Q62,51 68,49" fill="none" stroke="rgba(20,80,20,0.15)" stroke-width="0.5"/>' +
      // Beak (curved, hooked - upper)
      '<path d="M42,54 Q46,52 50,54 Q54,52 58,54 Q56,62 50,66 Q44,62 42,54 Z" fill="#E8A020"/>' +
      // Beak hook (lower curve)
      '<path d="M44,56 Q50,54 56,56 Q54,60 50,62 Q46,60 44,56 Z" fill="#D08810" opacity="0.6"/>' +
      // Beak highlight
      '<path d="M46,55 Q50,53.5 54,55" fill="none" stroke="#F0C040" stroke-width="0.8" opacity="0.5"/>' +
      // Nostril dots on beak
      '<circle cx="47" cy="56" r="0.8" fill="#A06808"/>' +
      '<circle cx="53" cy="56" r="0.8" fill="#A06808"/>' +
    '</svg>',

    turtle: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="ttFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#7A9858"/>' +
          '<stop offset="60%" stop-color="#5A7838"/>' +
          '<stop offset="100%" stop-color="#3A5818"/>' +
        '</radialGradient>' +
        '<radialGradient id="ttHighlight" cx="42%" cy="28%" r="38%">' +
          '<stop offset="0%" stop-color="rgba(160,200,120,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(160,200,120,0)"/>' +
        '</radialGradient>' +
        '<pattern id="ttFurTex" patternUnits="userSpaceOnUse" width="4" height="4">' +
          '<circle cx="2" cy="2" r="0.5" fill="rgba(40,60,20,0.06)"/>' +
          '<line x1="0" y1="2" x2="4" y2="2.5" stroke="rgba(80,120,50,0.04)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Shell (large circle)
      '<circle cx="50" cy="56" r="38" fill="url(#ttFur1)"/>' +
      '<circle cx="50" cy="56" r="38" fill="url(#ttFurTex)"/>' +
      '<circle cx="50" cy="56" r="38" fill="url(#ttHighlight)"/>' +
      // Shell hexagonal pattern
      '<path d="M50,28 L68,38 L68,58 L50,68 L32,58 L32,38 Z" fill="none" stroke="#4A6828" stroke-width="1.5" opacity="0.4"/>' +
      '<path d="M50,28 L50,68" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.3"/>' +
      '<path d="M32,38 L68,58" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.3"/>' +
      '<path d="M68,38 L32,58" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.3"/>' +
      // Outer shell segments
      '<path d="M50,28 L58,20 Q68,24 68,38" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.25"/>' +
      '<path d="M50,28 L42,20 Q32,24 32,38" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.25"/>' +
      '<path d="M68,38 L80,42 Q82,52 68,58" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.25"/>' +
      '<path d="M32,38 L20,42 Q18,52 32,58" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.25"/>' +
      '<path d="M68,58 L72,70 Q62,76 50,68" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.25"/>' +
      '<path d="M32,58 L28,70 Q38,76 50,68" fill="none" stroke="#4A6828" stroke-width="1" opacity="0.25"/>' +
      // Shell rim highlight
      '<path d="M22,40 Q50,20 78,40" fill="none" stroke="rgba(180,220,140,0.2)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Head (poking out from top, different green)
      '<ellipse cx="50" cy="24" rx="16" ry="14" fill="#6A8848"/>' +
      '<ellipse cx="50" cy="23" rx="13" ry="11" fill="#7A9858" opacity="0.5"/>' +
      // Rim light on head
      '<path d="M38,18 Q50,10 62,18" fill="none" stroke="rgba(180,220,140,0.25)" stroke-width="1.2" stroke-linecap="round"/>' +
      // Eyes (small, beady, on the head)
      '<ellipse cx="43" cy="22" rx="4.5" ry="5" fill="white"/>' +
      '<ellipse cx="57" cy="22" rx="4.5" ry="5" fill="white"/>' +
      '<ellipse cx="43.5" cy="22" rx="2.5" ry="3" fill="#2A3A10"/>' +
      '<ellipse cx="57.5" cy="22" rx="2.5" ry="3" fill="#2A3A10"/>' +
      '<ellipse cx="44" cy="22.5" rx="1.5" ry="2" fill="#1A2008"/>' +
      '<ellipse cx="58" cy="22.5" rx="1.5" ry="2" fill="#1A2008"/>' +
      // Eye highlights
      '<circle cx="45" cy="20.5" r="1" fill="white"/>' +
      '<circle cx="59" cy="20.5" r="1" fill="white"/>' +
      '<circle cx="43" cy="24" r="0.5" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="57" cy="24" r="0.5" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M39,26 Q43,27.5 47,26" fill="none" stroke="rgba(50,70,20,0.15)" stroke-width="0.5"/>' +
      '<path d="M53,26 Q57,27.5 61,26" fill="none" stroke="rgba(50,70,20,0.15)" stroke-width="0.5"/>' +
      // Nose (tiny nostrils)
      '<circle cx="48" cy="28" r="0.8" fill="#3A5020"/>' +
      '<circle cx="52" cy="28" r="0.8" fill="#3A5020"/>' +
      '<circle cx="48" cy="27.8" r="0.3" fill="rgba(255,255,255,0.1)"/>' +
      '<circle cx="52" cy="27.8" r="0.3" fill="rgba(255,255,255,0.1)"/>' +
      // Mouth (tiny beak-like)
      '<path d="M46,31 Q50,34 54,31" fill="none" stroke="#3A5020" stroke-width="1" stroke-linecap="round"/>' +
    '</svg>',

    // ---- WAVE 3 NEW ANIMALS ----

    goat: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="gtFur1" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="#F0EDE8"/>' +
          '<stop offset="60%" stop-color="#D8D2C8"/>' +
          '<stop offset="100%" stop-color="#B0A898"/>' +
        '</radialGradient>' +
        '<radialGradient id="gtHighlight" cx="40%" cy="25%" r="40%">' +
          '<stop offset="0%" stop-color="rgba(255,255,255,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(255,255,255,0)"/>' +
        '</radialGradient>' +
        '<pattern id="gtFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<circle cx="1.5" cy="1.5" r="0.4" fill="rgba(160,150,130,0.06)"/>' +
          '<line x1="0" y1="1" x2="3" y2="2" stroke="rgba(180,170,150,0.04)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Body
      '<circle cx="50" cy="55" r="38" fill="url(#gtFur1)"/>' +
      '<circle cx="50" cy="55" r="38" fill="url(#gtFurTex)"/>' +
      '<circle cx="50" cy="55" r="38" fill="url(#gtHighlight)"/>' +
      // Horns
      '<path d="M32,30 Q28,10 22,5" fill="none" stroke="#8B8070" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M68,30 Q72,10 78,5" fill="none" stroke="#8B8070" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M32,30 Q28,10 22,5" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M68,30 Q72,10 78,5" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" stroke-linecap="round"/>' +
      // Horn ridges
      '<path d="M30,25 Q27,14 23,8" fill="none" stroke="rgba(100,90,70,0.2)" stroke-width="0.5" stroke-dasharray="1.5,2"/>' +
      '<path d="M70,25 Q73,14 77,8" fill="none" stroke="rgba(100,90,70,0.2)" stroke-width="0.5" stroke-dasharray="1.5,2"/>' +
      // Floppy ears
      '<ellipse cx="22" cy="42" rx="10" ry="6" fill="#D0C8B8" transform="rotate(-25,22,42)"/>' +
      '<ellipse cx="22" cy="42" rx="7" ry="4" fill="#E0BBA0" opacity="0.4" transform="rotate(-25,22,42)"/>' +
      '<ellipse cx="78" cy="42" rx="10" ry="6" fill="#D0C8B8" transform="rotate(25,78,42)"/>' +
      '<ellipse cx="78" cy="42" rx="7" ry="4" fill="#E0BBA0" opacity="0.4" transform="rotate(25,78,42)"/>' +
      // Rim light
      '<path d="M30,32 Q50,20 70,32" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.8" stroke-linecap="round"/>' +
      // Muzzle
      '<ellipse cx="50" cy="64" rx="18" ry="14" fill="#E8E0D4"/>' +
      '<ellipse cx="50" cy="66" rx="14" ry="10" fill="#F0EAE0" opacity="0.4"/>' +
      // Eyes - rectangular horizontal pupils
      '<ellipse cx="37" cy="46" rx="7" ry="7.5" fill="white"/>' +
      '<ellipse cx="63" cy="46" rx="7" ry="7.5" fill="white"/>' +
      '<ellipse cx="37.5" cy="46" rx="4" ry="4.5" fill="#C8A832"/>' +
      '<ellipse cx="63.5" cy="46" rx="4" ry="4.5" fill="#C8A832"/>' +
      // Rectangular horizontal slit pupils
      '<rect x="35" y="45" width="5.5" height="2.5" rx="0.3" fill="#111"/>' +
      '<rect x="61" y="45" width="5.5" height="2.5" rx="0.3" fill="#111"/>' +
      // Eye highlights
      '<circle cx="39" cy="44" r="1.3" fill="white"/>' +
      '<circle cx="65" cy="44" r="1.3" fill="white"/>' +
      '<circle cx="36.5" cy="48" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="62.5" cy="48" r="0.6" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M30,50 Q37,52 44,50" fill="none" stroke="rgba(140,130,110,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,50 Q63,52 70,50" fill="none" stroke="rgba(140,130,110,0.15)" stroke-width="0.5"/>' +
      // Nose
      '<ellipse cx="46" cy="62" rx="2.2" ry="1.8" fill="#B0A090"/>' +
      '<ellipse cx="54" cy="62" rx="2.2" ry="1.8" fill="#B0A090"/>' +
      '<ellipse cx="46" cy="61.6" rx="0.8" ry="0.4" fill="rgba(255,255,255,0.12)"/>' +
      '<ellipse cx="54" cy="61.6" rx="0.8" ry="0.4" fill="rgba(255,255,255,0.12)"/>' +
      // Mouth
      '<path d="M44,66 Q50,70 56,66" fill="none" stroke="#A09080" stroke-width="1" stroke-linecap="round"/>' +
      // Beard tuft
      '<path d="M46,72 Q50,82 54,72" fill="#C8C0B0" stroke="#B8B0A0" stroke-width="0.5"/>' +
      '<path d="M48,73 Q50,79 52,73" fill="#D8D0C4" opacity="0.5"/>' +
      '<line x1="50" y1="72" x2="50" y2="78" stroke="rgba(160,150,130,0.2)" stroke-width="0.4"/>' +
    '</svg>',

    spider: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="sdFur1" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="#4A3060"/>' +
          '<stop offset="60%" stop-color="#2E1A40"/>' +
          '<stop offset="100%" stop-color="#1A0E28"/>' +
        '</radialGradient>' +
        '<radialGradient id="sdHighlight" cx="40%" cy="25%" r="40%">' +
          '<stop offset="0%" stop-color="rgba(120,80,160,0.3)"/>' +
          '<stop offset="100%" stop-color="rgba(120,80,160,0)"/>' +
        '</radialGradient>' +
        '<pattern id="sdFurTex" patternUnits="userSpaceOnUse" width="10" height="10">' +
          '<circle cx="5" cy="5" r="4" fill="none" stroke="rgba(100,70,140,0.04)" stroke-width="0.3"/>' +
          '<line x1="0" y1="5" x2="10" y2="5" stroke="rgba(80,50,120,0.03)" stroke-width="0.2"/>' +
          '<line x1="5" y1="0" x2="5" y2="10" stroke="rgba(80,50,120,0.03)" stroke-width="0.2"/>' +
        '</pattern>' +
      '</defs>' +
      // Background web pattern
      '<circle cx="50" cy="50" r="46" fill="none" stroke="rgba(200,200,220,0.06)" stroke-width="0.5"/>' +
      '<circle cx="50" cy="50" r="32" fill="none" stroke="rgba(200,200,220,0.05)" stroke-width="0.4"/>' +
      '<circle cx="50" cy="50" r="18" fill="none" stroke="rgba(200,200,220,0.04)" stroke-width="0.3"/>' +
      '<line x1="50" y1="4" x2="50" y2="96" stroke="rgba(200,200,220,0.05)" stroke-width="0.3"/>' +
      '<line x1="4" y1="50" x2="96" y2="50" stroke="rgba(200,200,220,0.05)" stroke-width="0.3"/>' +
      '<line x1="14" y1="14" x2="86" y2="86" stroke="rgba(200,200,220,0.04)" stroke-width="0.3"/>' +
      '<line x1="86" y1="14" x2="14" y2="86" stroke="rgba(200,200,220,0.04)" stroke-width="0.3"/>' +
      // 8 Legs (4 per side — jointed, angular, radiating from cephalothorax)
      // Left legs (front to back)
      '<path d="M34,30 L18,18 L6,28" fill="none" stroke="#3A2050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M32,36 L12,34 L2,46" fill="none" stroke="#3A2050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M30,42 L10,48 L2,64" fill="none" stroke="#3A2050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M32,48 L14,60 L6,78" fill="none" stroke="#3A2050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      // Right legs (front to back)
      '<path d="M66,30 L82,18 L94,28" fill="none" stroke="#3A2050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M68,36 L88,34 L98,46" fill="none" stroke="#3A2050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M70,42 L90,48 L98,64" fill="none" stroke="#3A2050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M68,48 L86,60 L94,78" fill="none" stroke="#3A2050" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      // Leg joint highlights
      '<circle cx="18" cy="18" r="1" fill="rgba(100,60,140,0.3)"/>' +
      '<circle cx="12" cy="34" r="1" fill="rgba(100,60,140,0.3)"/>' +
      '<circle cx="10" cy="48" r="1" fill="rgba(100,60,140,0.3)"/>' +
      '<circle cx="14" cy="60" r="1" fill="rgba(100,60,140,0.3)"/>' +
      '<circle cx="82" cy="18" r="1" fill="rgba(100,60,140,0.3)"/>' +
      '<circle cx="88" cy="34" r="1" fill="rgba(100,60,140,0.3)"/>' +
      '<circle cx="90" cy="48" r="1" fill="rgba(100,60,140,0.3)"/>' +
      '<circle cx="86" cy="60" r="1" fill="rgba(100,60,140,0.3)"/>' +
      // Abdomen (large, round)
      '<ellipse cx="50" cy="62" rx="30" ry="28" fill="url(#sdFur1)"/>' +
      '<ellipse cx="50" cy="62" rx="30" ry="28" fill="url(#sdFurTex)"/>' +
      '<ellipse cx="50" cy="62" rx="30" ry="28" fill="url(#sdHighlight)"/>' +
      // Abdomen markings
      '<ellipse cx="50" cy="68" rx="8" ry="12" fill="rgba(80,50,110,0.15)"/>' +
      '<path d="M42,58 L50,64 L58,58" fill="none" stroke="rgba(100,60,140,0.12)" stroke-width="1"/>' +
      '<path d="M40,66 L50,72 L60,66" fill="none" stroke="rgba(100,60,140,0.1)" stroke-width="0.8"/>' +
      // Head (cephalothorax)
      '<ellipse cx="50" cy="34" rx="22" ry="20" fill="#3A2050"/>' +
      '<ellipse cx="50" cy="33" rx="18" ry="16" fill="#4A2860" opacity="0.5"/>' +
      // Rim light
      '<path d="M32,26 Q50,14 68,26" fill="none" stroke="rgba(160,120,200,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // 4 large front eyes
      '<ellipse cx="40" cy="32" rx="6" ry="6.5" fill="#1A1020"/>' +
      '<ellipse cx="60" cy="32" rx="6" ry="6.5" fill="#1A1020"/>' +
      '<ellipse cx="40" cy="32" rx="5" ry="5.5" fill="#201428"/>' +
      '<ellipse cx="60" cy="32" rx="5" ry="5.5" fill="#201428"/>' +
      '<circle cx="40" cy="32" r="3.5" fill="#2A1A35"/>' +
      '<circle cx="60" cy="32" r="3.5" fill="#2A1A35"/>' +
      // Large eye highlights
      '<circle cx="42" cy="30" r="1.8" fill="rgba(255,255,255,0.7)"/>' +
      '<circle cx="62" cy="30" r="1.8" fill="rgba(255,255,255,0.7)"/>' +
      '<circle cx="39" cy="34" r="0.8" fill="rgba(255,255,255,0.3)"/>' +
      '<circle cx="59" cy="34" r="0.8" fill="rgba(255,255,255,0.3)"/>' +
      // 4 small upper eyes
      '<circle cx="36" cy="24" r="3" fill="#1A1020"/>' +
      '<circle cx="44" cy="22" r="3" fill="#1A1020"/>' +
      '<circle cx="56" cy="22" r="3" fill="#1A1020"/>' +
      '<circle cx="64" cy="24" r="3" fill="#1A1020"/>' +
      '<circle cx="36" cy="24" r="2" fill="#251830"/>' +
      '<circle cx="44" cy="22" r="2" fill="#251830"/>' +
      '<circle cx="56" cy="22" r="2" fill="#251830"/>' +
      '<circle cx="64" cy="24" r="2" fill="#251830"/>' +
      // Small eye highlights
      '<circle cx="37" cy="23" r="0.9" fill="rgba(255,255,255,0.5)"/>' +
      '<circle cx="45" cy="21" r="0.9" fill="rgba(255,255,255,0.5)"/>' +
      '<circle cx="57" cy="21" r="0.9" fill="rgba(255,255,255,0.5)"/>' +
      '<circle cx="65" cy="23" r="0.9" fill="rgba(255,255,255,0.5)"/>' +
      // Fangs (chelicerae)
      '<path d="M44,40 Q43,46 45,48" fill="none" stroke="#6A4880" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M56,40 Q57,46 55,48" fill="none" stroke="#6A4880" stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="45" cy="48" r="0.8" fill="#8A6898"/>' +
      '<circle cx="55" cy="48" r="0.8" fill="#8A6898"/>' +
    '</svg>',

    ladybug: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="lbShell1" cx="50%" cy="45%" r="50%">' +
          '<stop offset="0%" stop-color="#E83020"/>' +
          '<stop offset="60%" stop-color="#CC2218"/>' +
          '<stop offset="100%" stop-color="#A01810"/>' +
        '</radialGradient>' +
        '<radialGradient id="lbHighlight" cx="38%" cy="28%" r="35%">' +
          '<stop offset="0%" stop-color="rgba(255,200,180,0.4)"/>' +
          '<stop offset="100%" stop-color="rgba(255,200,180,0)"/>' +
        '</radialGradient>' +
        '<pattern id="lbShellTex" patternUnits="userSpaceOnUse" width="4" height="4">' +
          '<circle cx="2" cy="2" r="0.3" fill="rgba(180,20,10,0.05)"/>' +
        '</pattern>' +
      '</defs>' +
      // Shell body
      '<ellipse cx="50" cy="56" rx="38" ry="34" fill="url(#lbShell1)"/>' +
      '<ellipse cx="50" cy="56" rx="38" ry="34" fill="url(#lbShellTex)"/>' +
      '<ellipse cx="50" cy="56" rx="38" ry="34" fill="url(#lbHighlight)"/>' +
      // Center line (wing split)
      '<line x1="50" y1="28" x2="50" y2="88" stroke="#1A0A08" stroke-width="1.8"/>' +
      // Black spots
      '<circle cx="36" cy="48" r="6" fill="#1A0A08"/>' +
      '<circle cx="64" cy="48" r="6" fill="#1A0A08"/>' +
      '<circle cx="32" cy="64" r="5.5" fill="#1A0A08"/>' +
      '<circle cx="68" cy="64" r="5.5" fill="#1A0A08"/>' +
      '<circle cx="42" cy="76" r="4.5" fill="#1A0A08"/>' +
      '<circle cx="58" cy="76" r="4.5" fill="#1A0A08"/>' +
      '<circle cx="50" cy="58" r="3" fill="#1A0A08"/>' +
      // Shell rim highlight
      '<path d="M16,50 Q50,22 84,50" fill="none" stroke="rgba(255,220,200,0.2)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Head (small, black)
      '<ellipse cx="50" cy="28" rx="18" ry="16" fill="#1A1018"/>' +
      '<ellipse cx="50" cy="27" rx="14" ry="12" fill="#2A1828" opacity="0.5"/>' +
      // Antennae
      '<path d="M42,18 Q36,6 30,4" fill="none" stroke="#1A1018" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M58,18 Q64,6 70,4" fill="none" stroke="#1A1018" stroke-width="1.5" stroke-linecap="round"/>' +
      '<circle cx="30" cy="4" r="2.5" fill="#1A1018"/>' +
      '<circle cx="70" cy="4" r="2.5" fill="#1A1018"/>' +
      // Rim light on head
      '<path d="M36,20 Q50,12 64,20" fill="none" stroke="rgba(180,180,200,0.2)" stroke-width="1.2" stroke-linecap="round"/>' +
      // Eyes (small, cute)
      '<ellipse cx="42" cy="28" rx="5" ry="5.5" fill="white"/>' +
      '<ellipse cx="58" cy="28" rx="5" ry="5.5" fill="white"/>' +
      '<ellipse cx="42.5" cy="28.5" rx="3" ry="3.5" fill="#111"/>' +
      '<ellipse cx="58.5" cy="28.5" rx="3" ry="3.5" fill="#111"/>' +
      // Eye highlights
      '<circle cx="44" cy="27" r="1.3" fill="white"/>' +
      '<circle cx="60" cy="27" r="1.3" fill="white"/>' +
      '<circle cx="41.5" cy="30" r="0.5" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="57.5" cy="30" r="0.5" fill="rgba(255,255,255,0.4)"/>' +
      // Mouth (tiny smile)
      '<path d="M46,34 Q50,37 54,34" fill="none" stroke="rgba(100,80,90,0.3)" stroke-width="0.8" stroke-linecap="round"/>' +
    '</svg>',

    bee: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="beFur1" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="#FFD640"/>' +
          '<stop offset="60%" stop-color="#E8B820"/>' +
          '<stop offset="100%" stop-color="#C89810"/>' +
        '</radialGradient>' +
        '<radialGradient id="beHighlight" cx="40%" cy="25%" r="40%">' +
          '<stop offset="0%" stop-color="rgba(255,240,180,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(255,240,180,0)"/>' +
        '</radialGradient>' +
        '<pattern id="beFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<circle cx="1.5" cy="1.5" r="0.5" fill="rgba(200,160,20,0.06)"/>' +
          '<circle cx="0.5" cy="0.5" r="0.3" fill="rgba(220,180,40,0.04)"/>' +
        '</pattern>' +
      '</defs>' +
      // Wings (behind body, translucent)
      '<ellipse cx="32" cy="30" rx="16" ry="10" fill="rgba(200,220,255,0.3)" stroke="rgba(180,200,240,0.3)" stroke-width="0.5" transform="rotate(-20,32,30)"/>' +
      '<ellipse cx="68" cy="30" rx="16" ry="10" fill="rgba(200,220,255,0.3)" stroke="rgba(180,200,240,0.3)" stroke-width="0.5" transform="rotate(20,68,30)"/>' +
      '<ellipse cx="28" cy="36" rx="12" ry="7" fill="rgba(200,220,255,0.2)" stroke="rgba(180,200,240,0.2)" stroke-width="0.4" transform="rotate(-30,28,36)"/>' +
      '<ellipse cx="72" cy="36" rx="12" ry="7" fill="rgba(200,220,255,0.2)" stroke="rgba(180,200,240,0.2)" stroke-width="0.4" transform="rotate(30,72,36)"/>' +
      // Body (fuzzy round)
      '<ellipse cx="50" cy="56" rx="32" ry="34" fill="url(#beFur1)"/>' +
      '<ellipse cx="50" cy="56" rx="32" ry="34" fill="url(#beFurTex)"/>' +
      '<ellipse cx="50" cy="56" rx="32" ry="34" fill="url(#beHighlight)"/>' +
      // Black stripes
      '<path d="M22,46 Q50,42 78,46" fill="none" stroke="#1A1008" stroke-width="6" opacity="0.8"/>' +
      '<path d="M20,60 Q50,56 80,60" fill="none" stroke="#1A1008" stroke-width="6" opacity="0.8"/>' +
      '<path d="M24,74 Q50,70 76,74" fill="none" stroke="#1A1008" stroke-width="6" opacity="0.8"/>' +
      // Fuzzy edge detail
      '<ellipse cx="50" cy="56" rx="32" ry="34" fill="none" stroke="rgba(200,170,40,0.15)" stroke-width="1.5"/>' +
      // Head area
      '<ellipse cx="50" cy="30" rx="20" ry="18" fill="#FFD640"/>' +
      '<ellipse cx="50" cy="29" rx="16" ry="14" fill="#FFE060" opacity="0.5"/>' +
      // Antennae
      '<path d="M42,16 Q38,6 34,2" fill="none" stroke="#1A1008" stroke-width="1.2" stroke-linecap="round"/>' +
      '<path d="M58,16 Q62,6 66,2" fill="none" stroke="#1A1008" stroke-width="1.2" stroke-linecap="round"/>' +
      '<circle cx="34" cy="2" r="2" fill="#1A1008"/>' +
      '<circle cx="66" cy="2" r="2" fill="#1A1008"/>' +
      // Rim light
      '<path d="M34,22 Q50,12 66,22" fill="none" stroke="rgba(255,240,180,0.3)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eyes (large compound)
      '<ellipse cx="38" cy="30" rx="8" ry="8.5" fill="#1A1008"/>' +
      '<ellipse cx="62" cy="30" rx="8" ry="8.5" fill="#1A1008"/>' +
      '<ellipse cx="38" cy="30" rx="6.5" ry="7" fill="#2A2018"/>' +
      '<ellipse cx="62" cy="30" rx="6.5" ry="7" fill="#2A2018"/>' +
      // Compound eye facets
      '<circle cx="36" cy="28" r="2" fill="rgba(60,40,20,0.3)"/>' +
      '<circle cx="40" cy="28" r="2" fill="rgba(60,40,20,0.3)"/>' +
      '<circle cx="38" cy="32" r="2" fill="rgba(60,40,20,0.3)"/>' +
      '<circle cx="60" cy="28" r="2" fill="rgba(60,40,20,0.3)"/>' +
      '<circle cx="64" cy="28" r="2" fill="rgba(60,40,20,0.3)"/>' +
      '<circle cx="62" cy="32" r="2" fill="rgba(60,40,20,0.3)"/>' +
      // Eye highlights
      '<circle cx="40" cy="27" r="2" fill="rgba(255,255,255,0.5)"/>' +
      '<circle cx="64" cy="27" r="2" fill="rgba(255,255,255,0.5)"/>' +
      '<circle cx="37" cy="33" r="0.8" fill="rgba(255,255,255,0.25)"/>' +
      '<circle cx="61" cy="33" r="0.8" fill="rgba(255,255,255,0.25)"/>' +
      // Mouth (cute smile)
      '<path d="M44,40 Q50,44 56,40" fill="none" stroke="#A08020" stroke-width="1" stroke-linecap="round"/>' +
    '</svg>',

    crocodile: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="crScale1" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="#4A6830"/>' +
          '<stop offset="60%" stop-color="#3A5420"/>' +
          '<stop offset="100%" stop-color="#2A3C14"/>' +
        '</radialGradient>' +
        '<radialGradient id="crHighlight" cx="40%" cy="25%" r="40%">' +
          '<stop offset="0%" stop-color="rgba(120,160,80,0.25)"/>' +
          '<stop offset="100%" stop-color="rgba(120,160,80,0)"/>' +
        '</radialGradient>' +
        '<pattern id="crScaleTex" patternUnits="userSpaceOnUse" width="6" height="6">' +
          '<path d="M0,3 Q3,1 6,3 Q3,5 0,3" fill="none" stroke="rgba(60,80,30,0.1)" stroke-width="0.4"/>' +
          '<path d="M3,0 Q6,2 3,4 Q0,2 3,0" fill="none" stroke="rgba(80,100,40,0.06)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Long snout
      '<ellipse cx="50" cy="70" rx="22" ry="14" fill="#4A6830"/>' +
      '<ellipse cx="50" cy="72" rx="18" ry="10" fill="#5A7840" opacity="0.4"/>' +
      // Body/head (broad)
      '<ellipse cx="50" cy="48" rx="36" ry="32" fill="url(#crScale1)"/>' +
      '<ellipse cx="50" cy="48" rx="36" ry="32" fill="url(#crScaleTex)"/>' +
      '<ellipse cx="50" cy="48" rx="36" ry="32" fill="url(#crHighlight)"/>' +
      // Ridged brow bumps
      '<ellipse cx="34" cy="30" rx="10" ry="6" fill="#3E5824"/>' +
      '<ellipse cx="66" cy="30" rx="10" ry="6" fill="#3E5824"/>' +
      '<ellipse cx="34" cy="29" rx="8" ry="4" fill="#4A6830" opacity="0.5"/>' +
      '<ellipse cx="66" cy="29" rx="8" ry="4" fill="#4A6830" opacity="0.5"/>' +
      // Ridge bumps along top
      '<circle cx="42" cy="22" r="3" fill="#3E5824"/>' +
      '<circle cx="50" cy="20" r="3.5" fill="#3E5824"/>' +
      '<circle cx="58" cy="22" r="3" fill="#3E5824"/>' +
      // Rim light
      '<path d="M28,28 Q50,16 72,28" fill="none" stroke="rgba(140,180,100,0.2)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Snout nostrils
      '<ellipse cx="44" cy="68" rx="2.5" ry="2" fill="#2A3C14"/>' +
      '<ellipse cx="56" cy="68" rx="2.5" ry="2" fill="#2A3C14"/>' +
      // Teeth peeking out
      '<polygon points="36,60 37.5,64 39,60" fill="#F0F0E0" opacity="0.7"/>' +
      '<polygon points="43,61 44.5,65 46,61" fill="#F0F0E0" opacity="0.6"/>' +
      '<polygon points="54,61 55.5,65 57,61" fill="#F0F0E0" opacity="0.6"/>' +
      '<polygon points="61,60 62.5,64 64,60" fill="#F0F0E0" opacity="0.7"/>' +
      // Jawline
      '<path d="M30,58 Q50,66 70,58" fill="none" stroke="#2A3C14" stroke-width="1.2"/>' +
      // Eyes (yellow, reptilian, on brow ridges)
      '<ellipse cx="34" cy="34" rx="6.5" ry="7" fill="#C8CC30"/>' +
      '<ellipse cx="66" cy="34" rx="6.5" ry="7" fill="#C8CC30"/>' +
      '<ellipse cx="34" cy="34" rx="5.5" ry="6" fill="#D8DC40"/>' +
      '<ellipse cx="66" cy="34" rx="5.5" ry="6" fill="#D8DC40"/>' +
      // Vertical slit pupils
      '<ellipse cx="34" cy="34" rx="2" ry="5.5" fill="#111"/>' +
      '<ellipse cx="66" cy="34" rx="2" ry="5.5" fill="#111"/>' +
      // Eye highlights
      '<circle cx="36" cy="31" r="1.5" fill="rgba(255,255,255,0.6)"/>' +
      '<circle cx="68" cy="31" r="1.5" fill="rgba(255,255,255,0.6)"/>' +
      '<circle cx="33" cy="37" r="0.6" fill="rgba(255,255,255,0.3)"/>' +
      '<circle cx="65" cy="37" r="0.6" fill="rgba(255,255,255,0.3)"/>' +
      // Lower eyelid
      '<path d="M28,38 Q34,40 40,38" fill="none" stroke="rgba(40,60,20,0.2)" stroke-width="0.5"/>' +
      '<path d="M60,38 Q66,40 72,38" fill="none" stroke="rgba(40,60,20,0.2)" stroke-width="0.5"/>' +
    '</svg>',

    dolphin: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="dlSkin1" cx="50%" cy="45%" r="50%">' +
          '<stop offset="0%" stop-color="#7090B8"/>' +
          '<stop offset="60%" stop-color="#5878A0"/>' +
          '<stop offset="100%" stop-color="#405878"/>' +
        '</radialGradient>' +
        '<radialGradient id="dlHighlight" cx="40%" cy="25%" r="40%">' +
          '<stop offset="0%" stop-color="rgba(160,200,240,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(160,200,240,0)"/>' +
        '</radialGradient>' +
        '<pattern id="dlSkinTex" patternUnits="userSpaceOnUse" width="4" height="4">' +
          '<circle cx="2" cy="2" r="0.3" fill="rgba(80,110,150,0.04)"/>' +
        '</pattern>' +
      '</defs>' +
      // Body (smooth, rounded)
      '<ellipse cx="50" cy="55" rx="36" ry="34" fill="url(#dlSkin1)"/>' +
      '<ellipse cx="50" cy="55" rx="36" ry="34" fill="url(#dlSkinTex)"/>' +
      '<ellipse cx="50" cy="55" rx="36" ry="34" fill="url(#dlHighlight)"/>' +
      // Belly (lighter underside)
      '<ellipse cx="50" cy="65" rx="24" ry="18" fill="#A0B8D0" opacity="0.35"/>' +
      // Dorsal fin
      '<path d="M50,22 Q46,10 42,6 Q50,14 52,22" fill="#506888"/>' +
      '<path d="M50,22 Q46,10 42,6" fill="none" stroke="rgba(160,200,240,0.2)" stroke-width="0.8"/>' +
      // Bottle nose snout
      '<ellipse cx="50" cy="72" rx="14" ry="10" fill="#6888A8"/>' +
      '<ellipse cx="50" cy="74" rx="10" ry="6" fill="#7898B4" opacity="0.4"/>' +
      // Rim light
      '<path d="M28,36 Q50,22 72,36" fill="none" stroke="rgba(180,210,240,0.25)" stroke-width="1.8" stroke-linecap="round"/>' +
      // Always-smiling mouth
      '<path d="M38,74 Q50,82 62,74" fill="none" stroke="#405060" stroke-width="1.2" stroke-linecap="round"/>' +
      // Mouth line (the rostrum split)
      '<path d="M36,70 Q50,72 64,70" fill="none" stroke="rgba(50,70,90,0.3)" stroke-width="0.8"/>' +
      // Eyes (intelligent, dark with big highlights)
      '<ellipse cx="35" cy="50" rx="6.5" ry="7" fill="white"/>' +
      '<ellipse cx="65" cy="50" rx="6.5" ry="7" fill="white"/>' +
      '<ellipse cx="35.5" cy="50.5" rx="4.5" ry="5" fill="#1A2838"/>' +
      '<ellipse cx="65.5" cy="50.5" rx="4.5" ry="5" fill="#1A2838"/>' +
      '<ellipse cx="36" cy="51" rx="3" ry="3.5" fill="#0A1420"/>' +
      '<ellipse cx="66" cy="51" rx="3" ry="3.5" fill="#0A1420"/>' +
      // Big highlights (intelligent look)
      '<circle cx="37.5" cy="48.5" r="2" fill="white" opacity="0.85"/>' +
      '<circle cx="67.5" cy="48.5" r="2" fill="white" opacity="0.85"/>' +
      '<circle cx="34" cy="52" r="1" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="64" cy="52" r="1" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="37" cy="53" r="0.6" fill="rgba(255,255,255,0.25)"/>' +
      '<circle cx="67" cy="53" r="0.6" fill="rgba(255,255,255,0.25)"/>' +
      // Lower eyelid
      '<path d="M29,54 Q35,56 41,54" fill="none" stroke="rgba(60,80,110,0.15)" stroke-width="0.5"/>' +
      '<path d="M59,54 Q65,56 71,54" fill="none" stroke="rgba(60,80,110,0.15)" stroke-width="0.5"/>' +
    '</svg>',

    rabbit: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="rbFur1" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#F5EDE0"/>' +
          '<stop offset="60%" stop-color="#E0D0B8"/>' +
          '<stop offset="100%" stop-color="#C8B898"/>' +
        '</radialGradient>' +
        '<radialGradient id="rbHighlight" cx="40%" cy="25%" r="40%">' +
          '<stop offset="0%" stop-color="rgba(255,255,255,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(255,255,255,0)"/>' +
        '</radialGradient>' +
        '<pattern id="rbFurTex" patternUnits="userSpaceOnUse" width="3" height="3">' +
          '<circle cx="1.5" cy="1.5" r="0.4" fill="rgba(180,160,130,0.05)"/>' +
          '<line x1="0" y1="1" x2="3" y2="2" stroke="rgba(200,180,150,0.03)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Very long upright ears (signature feature)
      '<ellipse cx="36" cy="20" rx="9" ry="28" fill="#E0D0B8"/>' +
      '<ellipse cx="64" cy="20" rx="9" ry="28" fill="#E0D0B8"/>' +
      // Inner ears (pink)
      '<ellipse cx="36" cy="18" rx="5.5" ry="22" fill="#E8A8A0" opacity="0.45"/>' +
      '<ellipse cx="64" cy="18" rx="5.5" ry="22" fill="#E8A8A0" opacity="0.45"/>' +
      '<ellipse cx="36" cy="16" rx="3" ry="16" fill="#F0B8B0" opacity="0.2"/>' +
      '<ellipse cx="64" cy="16" rx="3" ry="16" fill="#F0B8B0" opacity="0.2"/>' +
      // Ear rim highlights
      '<path d="M30,8 Q36,-6 42,8" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" stroke-linecap="round"/>' +
      '<path d="M58,8 Q64,-6 70,8" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" stroke-linecap="round"/>' +
      // Body
      '<circle cx="50" cy="60" r="34" fill="url(#rbFur1)"/>' +
      '<circle cx="50" cy="60" r="34" fill="url(#rbFurTex)"/>' +
      '<circle cx="50" cy="60" r="34" fill="url(#rbHighlight)"/>' +
      // Cheek fluff
      '<ellipse cx="30" cy="62" rx="10" ry="8" fill="#F0E4D4" opacity="0.4"/>' +
      '<ellipse cx="70" cy="62" rx="10" ry="8" fill="#F0E4D4" opacity="0.4"/>' +
      // Rim light
      '<path d="M28,44 Q50,34 72,44" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eyes (big, round)
      '<ellipse cx="37" cy="56" rx="7.5" ry="8" fill="white"/>' +
      '<ellipse cx="63" cy="56" rx="7.5" ry="8" fill="white"/>' +
      '<ellipse cx="37.5" cy="56.5" rx="4.5" ry="5" fill="#6A3828"/>' +
      '<ellipse cx="63.5" cy="56.5" rx="4.5" ry="5" fill="#6A3828"/>' +
      '<ellipse cx="38" cy="57" rx="2.8" ry="3.2" fill="#2A1008"/>' +
      '<ellipse cx="64" cy="57" rx="2.8" ry="3.2" fill="#2A1008"/>' +
      // Eye highlights
      '<circle cx="39.5" cy="54.5" r="1.8" fill="white"/>' +
      '<circle cx="65.5" cy="54.5" r="1.8" fill="white"/>' +
      '<circle cx="36.5" cy="58.5" r="0.7" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="62.5" cy="58.5" r="0.7" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelid
      '<path d="M30,60 Q37,62 44,60" fill="none" stroke="rgba(160,140,110,0.12)" stroke-width="0.5"/>' +
      '<path d="M56,60 Q63,62 70,60" fill="none" stroke="rgba(160,140,110,0.12)" stroke-width="0.5"/>' +
      // Small pink nose
      '<ellipse cx="50" cy="66" rx="3.5" ry="2.8" fill="#E89898"/>' +
      '<ellipse cx="49.5" cy="65.5" rx="1.2" ry="0.6" fill="rgba(255,255,255,0.2)"/>' +
      // Nose to mouth line
      '<line x1="50" y1="68.5" x2="50" y2="71" stroke="#C88888" stroke-width="0.8"/>' +
      // Mouth (with buck teeth)
      '<path d="M45,71 Q50,74 55,71" fill="none" stroke="#B08080" stroke-width="0.8" stroke-linecap="round"/>' +
      // Buck teeth
      '<rect x="47" y="71" width="3" height="4" rx="0.8" fill="#FFF8F0" stroke="#D0C0B0" stroke-width="0.3"/>' +
      '<rect x="50" y="71" width="3" height="4" rx="0.8" fill="#FFF8F0" stroke="#D0C0B0" stroke-width="0.3"/>' +
      '<line x1="50" y1="71" x2="50" y2="75" stroke="rgba(180,160,140,0.2)" stroke-width="0.3"/>' +
    '</svg>',

    dodo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
        '<radialGradient id="ddBody" cx="50%" cy="55%" r="50%">' +
          '<stop offset="0%" stop-color="#A89888"/>' +
          '<stop offset="50%" stop-color="#887868"/>' +
          '<stop offset="100%" stop-color="#685848"/>' +
        '</radialGradient>' +
        '<radialGradient id="ddHead" cx="45%" cy="40%" r="50%">' +
          '<stop offset="0%" stop-color="#8A8090"/>' +
          '<stop offset="60%" stop-color="#6A6070"/>' +
          '<stop offset="100%" stop-color="#504858"/>' +
        '</radialGradient>' +
        '<radialGradient id="ddHighlight" cx="38%" cy="22%" r="42%">' +
          '<stop offset="0%" stop-color="rgba(200,190,210,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(200,190,210,0)"/>' +
        '</radialGradient>' +
        '<pattern id="ddFeatTex" patternUnits="userSpaceOnUse" width="4" height="5">' +
          '<path d="M0,2.5 Q2,1 4,2.5 Q2,4 0,2.5" fill="none" stroke="rgba(90,70,55,0.06)" stroke-width="0.3"/>' +
        '</pattern>' +
      '</defs>' +
      // Chunky yellow feet (behind body)
      '<ellipse cx="38" cy="94" rx="10" ry="4" fill="#D4A830"/>' +
      '<ellipse cx="62" cy="94" rx="10" ry="4" fill="#D4A830"/>' +
      '<path d="M30,94 L34,88" fill="none" stroke="#C49820" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M38,94 L38,86" fill="none" stroke="#C49820" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M46,94 L42,88" fill="none" stroke="#C49820" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M54,94 L58,88" fill="none" stroke="#C49820" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M62,94 L62,86" fill="none" stroke="#C49820" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M70,94 L66,88" fill="none" stroke="#C49820" stroke-width="2.5" stroke-linecap="round"/>' +
      // Curly tail tuft (behind body)
      '<path d="M46,82 Q42,76 44,70" fill="none" stroke="#9A8A78" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M50,80 Q48,72 52,66" fill="none" stroke="#A89888" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M54,82 Q58,76 56,70" fill="none" stroke="#8A7A68" stroke-width="2.5" stroke-linecap="round"/>' +
      '<circle cx="44" cy="69" r="2" fill="#B0A090"/>' +
      '<circle cx="52" cy="65" r="1.8" fill="#C0B0A0"/>' +
      '<circle cx="56" cy="69" r="2" fill="#A09080"/>' +
      // Plump round body
      '<ellipse cx="50" cy="62" rx="34" ry="30" fill="url(#ddBody)"/>' +
      '<ellipse cx="50" cy="62" rx="34" ry="30" fill="url(#ddFeatTex)"/>' +
      // Belly lighter patch
      '<ellipse cx="50" cy="68" rx="18" ry="14" fill="#C0B0A0" opacity="0.2"/>' +
      // Stubby little wings (adorably small for such a big bird)
      '<ellipse cx="20" cy="58" rx="6" ry="12" fill="#786858" transform="rotate(20,20,58)"/>' +
      '<path d="M16,50 Q14,58 18,66" fill="none" stroke="rgba(200,190,170,0.2)" stroke-width="0.8"/>' +
      '<ellipse cx="80" cy="58" rx="6" ry="12" fill="#786858" transform="rotate(-20,80,58)"/>' +
      '<path d="M84,50 Q86,58 82,66" fill="none" stroke="rgba(200,190,170,0.2)" stroke-width="0.8"/>' +
      // Feather texture marks on body
      '<path d="M30,55 Q34,53 38,55" fill="none" stroke="rgba(120,100,80,0.08)" stroke-width="0.8"/>' +
      '<path d="M62,55 Q66,53 70,55" fill="none" stroke="rgba(120,100,80,0.08)" stroke-width="0.8"/>' +
      '<path d="M34,65 Q38,63 42,65" fill="none" stroke="rgba(120,100,80,0.06)" stroke-width="0.8"/>' +
      '<path d="M58,65 Q62,63 66,65" fill="none" stroke="rgba(120,100,80,0.06)" stroke-width="0.8"/>' +
      // Head (slightly grayish-brown, plump)
      '<ellipse cx="50" cy="30" rx="22" ry="20" fill="url(#ddHead)"/>' +
      '<ellipse cx="50" cy="30" rx="22" ry="20" fill="url(#ddHighlight)"/>' +
      // Head tuft — wild messy feathers sticking up
      '<path d="M42,12 Q38,4 36,2" fill="none" stroke="#6A5858" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M46,11 Q44,2 42,0" fill="none" stroke="#7A6868" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M50,10 Q52,2 50,0" fill="none" stroke="#6A6068" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M54,11 Q58,3 60,2" fill="none" stroke="#7A6868" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M58,13 Q62,6 66,4" fill="none" stroke="#6A5858" stroke-width="1.5" stroke-linecap="round"/>' +
      // Feather tips on tuft
      '<circle cx="36" cy="2" r="1.5" fill="#8A7878"/>' +
      '<circle cx="42" cy="0" r="1.2" fill="#9A8888"/>' +
      '<circle cx="50" cy="0" r="1.5" fill="#8A8090"/>' +
      '<circle cx="60" cy="2" r="1.2" fill="#9A8888"/>' +
      '<circle cx="66" cy="4" r="1" fill="#8A7878"/>' +
      // Rim light on head
      '<path d="M32,20 Q50,10 68,20" fill="none" stroke="rgba(210,200,220,0.3)" stroke-width="1.5" stroke-linecap="round"/>' +
      // Eyes — big, round, same size, slightly dopey/lovable
      '<ellipse cx="38" cy="28" rx="7" ry="7.5" fill="white"/>' +
      '<ellipse cx="62" cy="28" rx="7" ry="7.5" fill="white"/>' +
      '<ellipse cx="38.5" cy="28.5" rx="4" ry="4.5" fill="#5A4030"/>' +
      '<ellipse cx="62.5" cy="28.5" rx="4" ry="4.5" fill="#5A4030"/>' +
      '<ellipse cx="39" cy="29" rx="2.5" ry="3" fill="#2A1808"/>' +
      '<ellipse cx="63" cy="29" rx="2.5" ry="3" fill="#2A1808"/>' +
      // Eye highlights
      '<circle cx="40.5" cy="26.5" r="2" fill="white"/>' +
      '<circle cx="64.5" cy="26.5" r="2" fill="white"/>' +
      '<circle cx="37" cy="31" r="0.8" fill="rgba(255,255,255,0.4)"/>' +
      '<circle cx="61" cy="31" r="0.8" fill="rgba(255,255,255,0.4)"/>' +
      // Lower eyelids
      '<path d="M32,33 Q38,35 44,33" fill="none" stroke="rgba(80,60,60,0.15)" stroke-width="0.5"/>' +
      '<path d="M56,33 Q62,35 68,33" fill="none" stroke="rgba(80,60,60,0.15)" stroke-width="0.5"/>' +
      // HUGE distinctive hooked beak (centered below face)
      '<path d="M44,38 Q50,36 56,38 Q62,40 64,46 Q62,52 56,54 Q50,56 44,54 Q38,52 36,46 Q38,40 44,38 Z" fill="#D8C040"/>' +
      '<path d="M46,40 Q50,38 54,40 Q58,42 60,46 Q58,50 54,52 Q50,53 46,52 Q42,50 40,46 Q42,42 46,40" fill="#E8D060" opacity="0.35"/>' +
      // Beak hook (curved downward tip at bottom)
      '<path d="M48,54 Q50,60 52,54" fill="#C0A828" stroke="#B09020" stroke-width="0.8"/>' +
      '<path d="M50,56 L50,58" fill="none" stroke="#B09020" stroke-width="1.5" stroke-linecap="round"/>' +
      // Beak ridge line
      '<path d="M44,38 Q50,36 56,38" fill="none" stroke="rgba(255,240,160,0.3)" stroke-width="1"/>' +
      // Nostrils
      '<ellipse cx="47" cy="44" rx="1.5" ry="1" fill="#B8A030"/>' +
      '<ellipse cx="53" cy="44" rx="1.5" ry="1" fill="#B8A030"/>' +
    '</svg>'

  };

  var ANIMAL_NAMES = {
    bear: 'Bear',
    cat: 'Cat',
    owl: 'Owl',
    penguin: 'Penguin',
    raccoon: 'Raccoon',
    frog: 'Frog',
    dog: 'Dog',
    panda: 'Panda',
    monkey: 'Monkey',
    deer: 'Deer',
    hedgehog: 'Hedgehog',
    shark: 'Shark',
    octopus: 'Octopus',
    hamster: 'Hamster',
    parrot: 'Parrot',
    turtle: 'Turtle',
    goat: 'Goat',
    spider: 'Spider',
    ladybug: 'Ladybug',
    bee: 'Bee',
    crocodile: 'Crocodile',
    dolphin: 'Dolphin',
    rabbit: 'Rabbit',
    dodo: 'Dodo'
  };

  function init() {
    for (var id in SVG_DEFS) {
      if (SVG_DEFS.hasOwnProperty(id)) {
        cache[id] = 'data:image/svg+xml;base64,' + btoa(SVG_DEFS[id]);
      }
    }
  }

  function getSprite(animalId) {
    return cache[animalId] || null;
  }

  function createSpriteImg(animalId, size) {
    var img = document.createElement('img');
    img.src = getSprite(animalId);
    img.alt = ANIMAL_NAMES[animalId] || animalId;
    img.draggable = false;
    if (size) {
      img.style.width = size + 'px';
      img.style.height = size + 'px';
    }
    return img;
  }

  // Custom display order for character picker (user-defined positions)
  var ANIMAL_ORDER = [
    'ladybug', 'cat', 'dog', 'owl', 'penguin', 'raccoon',
    'bear', 'frog', 'panda', 'monkey', 'deer', 'hedgehog',
    'dolphin', 'shark', 'octopus', 'hamster', 'goat', 'parrot',
    'turtle', 'spider', 'bee', 'crocodile', 'rabbit', 'dodo'
  ];

  function getAnimalList() {
    return ANIMAL_ORDER.slice();
  }

  function getAnimalName(id) {
    return ANIMAL_NAMES[id] || id;
  }

  // Initialize on load
  init();

  return {
    getSprite: getSprite,
    createSpriteImg: createSpriteImg,
    getAnimalList: getAnimalList,
    getAnimalName: getAnimalName
  };
})();
