const video = document.getElementById('video-feed');
const canvasElement = document.getElementById('canvas-overlay');
const canvasCtx = canvasElement.getContext('2d');

// State
let chemicalData = { blocks: {}, elements: [] };
let reactionsData = [];
let mode = 'LAB'; // 'LAB' or 'PT'
let loadedChemical = null;
let beakerChemical = null;
let currentReaction = null;
let currentReactionId = null;
let pickerOpen = false;
let guideOpen = false;
let activeBlock = 's_block';

// DOM Elements
const uiLayer = document.getElementById('ui-layer');
const modeHint = document.getElementById('mode-hint');
const tubeIcon = document.getElementById('tube-icon');
const guideIcon = document.getElementById('guide-icon');
const labGuide = document.getElementById('lab-guide');
const beakerZone = document.getElementById('beaker-zone');
const dropRing = document.getElementById('drop-ring');
const beakerLiquid = document.getElementById('beaker-liquid');
const beakerLabel = document.getElementById('beaker-label');
const chemPicker = document.getElementById('chem-picker');
const blockTabs = document.getElementById('block-tabs');
const chemGrid = document.getElementById('chem-grid');
const ptMode = document.getElementById('pt-mode');
const ptGrid = document.getElementById('pt-grid');
const ptCard = document.getElementById('pt-card');
const infoIdle = document.getElementById('info-idle');
const infoLoaded = document.getElementById('info-loaded');
const infoBeaker = document.getElementById('info-beaker');
const infoReaction = document.getElementById('info-reaction');

// Gesture Tracking State
let lastTriggerTime = 0;
let hoveredChem = null;
let pinchedChem = null;
let ptTimerElement = null;
let ptHoldTimer = null;
let fistFrames = 0;
let fiveFrames = 0;

// Vibrant per-chemical colors for the finger glow
const chemColors = {
    // s-block / salts
    'Na':              '#ffe066',
    'Ca':              '#ffe066',
    'K':               '#ffe066',
    'Li':              '#ffe066',
    'Mg':              '#ffe066',
    'Ba':              '#ffe066',
    'NaHCO3':          '#ffe066',
    'CaO':             '#ffe066',
    'Na2CO3':          '#ffe066',
    'NaOH':            '#ffe066',
    'NaOH(conc)':      '#ffe066',
    'KOH':             '#ffe066',
    // p-block compounds
    'KI':              '#a259ff',
    'AgNO3':           '#c0c0c0',
    'NaCl':            '#e0e0e0',
    'BaCl2':           '#80ffea',
    'Na2SO4':          '#80ffea',
    'HCl':             '#00eaff',
    'H2SO4(dil)':      '#00eaff',
    'H2SO4(conc)':     '#00eaff',
    'HNO3(conc)':      '#ff4444',
    'Pb(NO3)2':        '#ffea00',
    // d-block
    'CuSO4':           '#00b4ff',
    'FeCl3':           '#c84800',
    'Cu':              '#ff8c42',
    'Zn':              '#c0d0ff',
    'Fe':              '#c84800',
    'KMnO4':           '#a000c8',
    'K2Cr2O7':         '#ff6a00',
    'FeSO4(acidic)':   '#6aff00',
    'K4[Fe(CN)6]':     '#005fff',
    // general
    'NH4Cl':           '#ffffff',
    'NH4OH(excess)':   '#b4ffb4',
};

function getGlowColor(chem) {
    if (chemColors[chem]) return chemColors[chem];
    // Fallback: match by block
    for (const [blk, list] of Object.entries(chemicalData.blocks)) {
        if (list.includes(chem)) {
            return blk === 's_block' ? '#ffe066'
                 : blk === 'p_block' ? '#a259ff'
                 : blk === 'd_block' ? '#00b4ff'
                 : '#ffffff';
        }
    }
    return '#ffffff';
}

// Block colors used for PT grid borders
const blockColors = {
    's_block': '#ffe066',
    'p_block': '#a259ff',
    'd_block': '#00b4ff',
    'general': '#ff78c8'
};

// Initialization
async function init() {
    // Fetch data
    const res = await fetch('/api/chemicals');
    chemicalData = await res.json();
    
    const rxnRes = await fetch('/api/reactions');
    const rxnData = await rxnRes.json();
    reactionsData = rxnData.reactions;
    
    renderPickerTabs();
    renderPTGrid();
    renderLabGuide('s_block');
    setupLabGuideTabs();
    updateUIState();
    
    // Key press for AI Examiner
    document.addEventListener('keypress', async (e) => {
        if (e.key === 'a' && currentReactionId) {
            triggerAIExaminer();
        }
    });
    
    const camStatus = document.getElementById('cam-status');
    
    // First explicitly request camera permission so the browser prompt appears
    try {
        camStatus.innerText = '📷 Requesting camera permission...';
        await navigator.mediaDevices.getUserMedia({ video: true });
    } catch(err) {
        camStatus.style.borderColor = '#ff4444';
        camStatus.innerHTML = '❌ Camera access denied.<br><small>Please allow camera in browser settings and refresh.</small>';
        return;
    }
    
    // Setup MediaPipe Hands
    camStatus.innerText = '⏳ Loading hand tracking model...';
    const hands = new Hands({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }});
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,          // back to full model — lite (0) causes wrong finger positions
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5
    });
    hands.onResults(onResults);
    
    camStatus.innerText = '📡 Starting camera feed...';
    const camera = new Camera(video, {
        onFrame: async () => {
            await hands.send({image: video});
        },
        width: 640,
        height: 480
    });
    
    try {
        await camera.start();
        // Success — hide status overlay
        camStatus.style.display = 'none';
        resizeCanvas();
        requestAnimationFrame(renderLoop); // Start independent render loop
    } catch(err) {
        camStatus.style.borderColor = '#ff4444';
        camStatus.innerHTML = `❌ Camera failed to start.<br><small>${err.message}</small>`;
    }
}

function resizeCanvas() {
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
    
    // Size the container to fit window while preserving aspect ratio
    const container = document.getElementById('camera-container');
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    const videoRatio = video.videoWidth / video.videoHeight;
    const windowRatio = window.innerWidth / window.innerHeight;
    
    if (windowRatio > videoRatio) {
        // Window is wider than video (pillarbox)
        container.style.height = window.innerHeight + 'px';
        container.style.width = (window.innerHeight * videoRatio) + 'px';
    } else {
        // Window is taller than video (letterbox)
        container.style.width = window.innerWidth + 'px';
        container.style.height = (window.innerWidth / videoRatio) + 'px';
    }
}
video.addEventListener('loadedmetadata', resizeCanvas);
window.addEventListener('resize', resizeCanvas);

// --- Gesture Detection Math ---
function dist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function processGestures(landmarks) {
    const coords = landmarks;
    
    const cx = (coords[2].x + coords[5].x + coords[9].x + coords[13].x + coords[17].x) / 5;
    const cy = (coords[2].y + coords[5].y + coords[9].y + coords[13].y + coords[17].y) / 5;
    const wrist = coords[0];
    
    const distToWrist = (idx) => dist(coords[idx], wrist);
    const isExtended = (tip, pip) => distToWrist(tip) > distToWrist(pip);
    const isCurled   = (tip, pip) => distToWrist(tip) < distToWrist(pip) * 0.9;
    
    // Pinch (continuous) — index tip close to thumb tip
    let pinchDist    = dist(coords[8], coords[4]);
    let refDistPinch = dist(coords[0], coords[5]);
    let isPinching   = pinchDist < refDistPinch * 0.55; // 0.75 was too large (permanently stuck), 0.55 is the sweet spot
    
    // Fist (continuous) — ALL four fingers curled
    const isFist = isCurled(8,6) && isCurled(12,10) && isCurled(16,14) && isCurled(20,18);
    
    // Open palm — ALL five fingers extended (thumb included)
    const openPalm = isExtended(4,3) && isExtended(8,6) && isExtended(12,10)
                  && isExtended(16,14) && isExtended(20,18);
    
    // Suppress pinch entirely when making a fist
    if (isFist) isPinching = false;
    
    const now = Date.now() / 1000;
    let gesture = 'NONE';
    
    // All discrete gestures share one debounce gate
    if (now - lastTriggerTime > 1.0) {
        // Count frames
        if (isFist)     fistFrames++;   else fistFrames = 0;
        if (openPalm)   fiveFrames++;   else fiveFrames = 0;
        
        // FIST: hold ~0.25s (8 frames at 30fps)
        if (fistFrames >= 8) {
            gesture = 'FIST';
            fistFrames = 0;
            fiveFrames = 0;
        }
        // FIVE-FINGERS (PT toggle): hold open palm for ~0.5s (15 frames)
        else if (fiveFrames >= 15) {
            gesture = 'FIVE_FINGERS';
            fistFrames = 0;
            fiveFrames = 0;
        }
    } else {
        // Inside debounce — still track fist for continuous scroll
        if (isFist) fistFrames++; else fistFrames = 0;
    }
    
    if (gesture !== 'NONE') lastTriggerTime = now;
    
    return { gesture, isPinching, isFist, indexTip: coords[8], thumbTip: coords[4] };
}

// Cache last seen landmarks so we can redraw every rAF even on skipped frames
let lastLandmarks   = null;
let smoothLandmarks = null;       // exponentially smoothed copy used for drawing
let missingFrames   = 0;
const MISSING_GRACE = 15;         // restored to 15 frames to prevent flickering
const SMOOTH        = 0.3;        // reduced smoothing factor: 0.3 is much more responsive (thumb won't lag)

function applySmoothing(raw, isPinching) {
    if (!smoothLandmarks || smoothLandmarks.length !== raw.length) {
        // First frame — initialise directly
        smoothLandmarks = raw.map(lm => ({x: lm.x, y: lm.y, z: lm.z}));
        return smoothLandmarks;
    }
    
    // Pinch Lock: if pinching, average the raw thumb and index tips to stop occlusion jitter
    if (isPinching) {
        const avgX = (raw[4].x + raw[8].x) / 2;
        const avgY = (raw[4].y + raw[8].y) / 2;
        const avgZ = (raw[4].z + raw[8].z) / 2;
        raw[4] = {...raw[4], x: avgX, y: avgY, z: avgZ};
        raw[8] = {...raw[8], x: avgX, y: avgY, z: avgZ};
    }
    
    for (let i = 0; i < raw.length; i++) {
        smoothLandmarks[i].x = smoothLandmarks[i].x * SMOOTH + raw[i].x * (1 - SMOOTH);
        smoothLandmarks[i].y = smoothLandmarks[i].y * SMOOTH + raw[i].y * (1 - SMOOTH);
        smoothLandmarks[i].z = smoothLandmarks[i].z * SMOOTH + raw[i].z * (1 - SMOOTH);
    }
    return smoothLandmarks;
}

// --- Render Loop (runs every frame via rAF, independent of MediaPipe) ---
function renderLoop() {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    const lm = smoothLandmarks; // draw the smoothed version
    if (lm) {
        drawConnectors(canvasCtx, lm, HAND_CONNECTIONS, {color: '#ff78c8', lineWidth: 2});
        
        for (let i = 0; i < lm.length; i++) {
            const x = lm[i].x * canvasElement.width;
            const y = lm[i].y * canvasElement.height;
            
            if (i === 8 && loadedChemical) {
                const color = getGlowColor(loadedChemical);
                const cx8 = x, cy8 = y;
                const grad1 = canvasCtx.createRadialGradient(cx8, cy8, 0, cx8, cy8, 36);
                grad1.addColorStop(0,   color + 'cc');
                grad1.addColorStop(0.4, color + '55');
                grad1.addColorStop(1,   color + '00');
                canvasCtx.beginPath();
                canvasCtx.arc(cx8, cy8, 36, 0, 2 * Math.PI);
                canvasCtx.fillStyle = grad1;
                canvasCtx.fill();
                canvasCtx.shadowBlur = 18;
                canvasCtx.shadowColor = color;
                canvasCtx.fillStyle = color;
                canvasCtx.beginPath();
                canvasCtx.arc(cx8, cy8, 7, 0, 2 * Math.PI);
                canvasCtx.fill();
                canvasCtx.shadowBlur = 0;
                canvasCtx.fillStyle = '#ffffff';
                canvasCtx.beginPath();
                canvasCtx.arc(cx8, cy8, 3, 0, 2 * Math.PI);
                canvasCtx.fill();
            } else {
                canvasCtx.fillStyle = '#ff78c8';
                const r = [4, 8, 12, 16, 20].includes(i) ? 4 : 2;
                canvasCtx.beginPath();
                canvasCtx.arc(x, y, r, 0, 2 * Math.PI);
                canvasCtx.fill();
            }
        }
    }
    
    canvasCtx.restore();
    requestAnimationFrame(renderLoop);
}

// --- Main Loop (MediaPipe callback — gesture only, no drawing) ---
function onResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {

        const raw = results.multiHandLandmarks[0];
        lastLandmarks = raw;
        missingFrames = 0;
        
        // Gesture processing — use RAW landmarks mirrored (smoothing not needed for gestures)
        const mirroredLandmarks = raw.map(lm => ({...lm, x: 1.0 - lm.x}));
        const gState = processGestures(mirroredLandmarks);
        
        // Update smoothed landmarks AFTER gestures so we can apply the Pinch Lock
        applySmoothing(raw, gState.isPinching);
        
        handleInteractions(gState);
    } else {
        missingFrames++;
        // Only clear after grace period — prevents flicker on brief detection gaps
        if (missingFrames >= MISSING_GRACE) {
            lastLandmarks   = null;
            smoothLandmarks = null;  // also reset smoothed so it re-initialises cleanly
        }
    }
}

// --- Interaction Logic ---
function handleInteractions(g) {
    // Global gestures
    if (g.gesture === 'FIVE_FINGERS') {
        mode = mode === 'LAB' ? 'PT' : 'LAB';
        pickerOpen = false;
        updateUIState();
        return;
    }
    
    if (g.isFist) {
        let scrollTarget = null;
        if (guideOpen) scrollTarget = document.getElementById('guide-rxn-list');
        else if (pickerOpen) scrollTarget = document.getElementById('chem-grid');
        
        if (scrollTarget) {
            // Tight proportional scroll: speed based on how far up or down the fist is
            const fy = g.indexTip.y;
            if (fy < 0.45) {
                // Scroll up (max speed 20px at top, min speed 2px at 0.45)
                scrollTarget.scrollTop -= Math.max(2, (0.45 - fy) * 45);
            } else if (fy > 0.55) {
                // Scroll down (max speed 20px at bottom, min speed 2px at 0.55)
                scrollTarget.scrollTop += Math.max(2, (fy - 0.55) * 45);
            }
        }
    }
    
    // Clear beaker on discrete FIST gesture trigger
    if (g.gesture === 'FIST' && mode === 'LAB' && !guideOpen && !pickerOpen) {
        beakerChemical = null;
        currentReaction = null;
        currentReactionId = null;
        updateUIState();
        return;
    }

    const container = document.getElementById('camera-container');
    const cRect = container.getBoundingClientRect();
    
    const ix = cRect.left + g.indexTip.x * cRect.width;
    const iy = cRect.top + g.indexTip.y * cRect.height;
    const tx = cRect.left + g.thumbTip.x * cRect.width;
    const ty = cRect.top + g.thumbTip.y * cRect.height;
    const midX = (ix + tx) / 2;
    const midY = (iy + ty) / 2;
    
    if (mode === 'PT') {
        handlePTInteraction(ix, iy, g.isPinching);
        return;
    }
    
    // Lab Mode
    
    // Check tube icon hover (chem picker)
    const tubeRect = tubeIcon.getBoundingClientRect();
    if (pointInRect(ix, iy, tubeRect)) {
        tubeIcon.classList.add('active');
        if (g.isPinching && !pickerOpen) {
            pickerOpen = true;
            guideOpen = false;
            renderPickerChem();
            updateUIState();
        }
    } else {
        tubeIcon.classList.remove('active');
    }
    
    // Check guide icon hover (lab guide)
    const guideRect = guideIcon.getBoundingClientRect();
    if (pointInRect(ix, iy, guideRect)) {
        guideIcon.classList.add('active');
        if (g.isPinching && !guideOpen) {
            guideOpen = true;
            pickerOpen = false;
            updateUIState();
        }
    } else {
        guideIcon.classList.remove('active');
    }
    
    // Check picker interactions if open
    if (pickerOpen) {
        // Tab hover
        document.querySelectorAll('.tab').forEach(tab => {
            const r = tab.getBoundingClientRect();
            if (pointInRect(ix, iy, r) && g.isPinching) {
                activeBlock = tab.dataset.block;
                renderPickerTabs();
                renderPickerChem();
            }
        });
        
        // Chem hover
        hoveredChem = null;
        document.querySelectorAll('.chem-pill').forEach(pill => {
            const r = pill.getBoundingClientRect();
            pill.classList.remove('hovered');
            if (pointInRect(ix, iy, r)) {
                hoveredChem = pill.dataset.chem;
                pill.classList.add('hovered');
                if (g.isPinching) {
                    loadedChemical = hoveredChem;
                    pickerOpen = false;
                    updateUIState();
                }
            }
        });
    }
    
    // Check lab guide interactions if open
    if (guideOpen) {
        // Guide Tab hover
        document.querySelectorAll('.guide-tab').forEach(tab => {
            const r = tab.getBoundingClientRect();
            if (pointInRect(ix, iy, r) && g.isPinching) {
                document.querySelectorAll('.guide-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderLabGuide(tab.dataset.block);
            }
        });
        
        // Guide Card hover
        document.querySelectorAll('.guide-rxn-card').forEach(card => {
            const r = card.getBoundingClientRect();
            card.classList.remove('hovered');
            if (pointInRect(ix, iy, r)) {
                card.classList.add('hovered'); // add a hover effect class in CSS if desired
                if (g.isPinching) {
                    beakerChemical = null;
                    currentReaction = null;
                    currentReactionId = null;
                    loadedChemical = null;
                    beakerChemical = card.dataset.r1;
                    loadedChemical = card.dataset.r2;
                    guideOpen = false;
                    updateUIState();
                }
            }
        });
    }
    
    // Beaker Interaction
    const beakerRect = beakerZone.getBoundingClientRect();
    if (loadedChemical && !g.isPinching && pointInRect(ix, iy, beakerRect)) {
        // Drop loaded chemical into beaker
        if (!beakerChemical) {
            beakerChemical = loadedChemical;
            loadedChemical = null;
            updateUIState();
        } else if (beakerChemical !== loadedChemical) {
            triggerReaction(beakerChemical, loadedChemical);
            loadedChemical = null;
        }
    }
}

function handlePTInteraction(x, y, isPinching) {
    let hovered = null;
    document.querySelectorAll('.pt-cell').forEach(cell => {
        const r = cell.getBoundingClientRect();
        cell.classList.remove('hovered');
        if (pointInRect(x, y, r)) {
            hovered = cell.dataset.sym;
            cell.classList.add('hovered');
        }
    });
    
    // If pinching an element, instantly show it
    if (hovered && isPinching) {
        clearTimeout(ptHoldTimer);
        ptTimerElement = hovered;
        showPTCard(hovered);
        return;
    }
    
    // Otherwise, require 1s of hovering
    if (hovered !== ptTimerElement) {
        clearTimeout(ptHoldTimer);
        ptTimerElement = hovered;
        if (hovered) {
            ptHoldTimer = setTimeout(() => {
                showPTCard(hovered);
            }, 1000);
        }
    }
}

function pointInRect(x, y, r) {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// --- UI Rendering ---

function updateUIState() {
    if (mode === 'PT') {
        ptMode.classList.remove('hidden');
        uiLayer.querySelector('#info-panel').classList.add('hidden');
        beakerZone.classList.add('hidden');
        tubeIcon.classList.add('hidden');
        guideIcon.classList.add('hidden');
        chemPicker.classList.add('hidden');
        modeHint.classList.add('hidden');
    } else {
        ptMode.classList.add('hidden');
        uiLayer.querySelector('#info-panel').classList.remove('hidden');
        beakerZone.classList.remove('hidden');
        tubeIcon.classList.remove('hidden');
        guideIcon.classList.remove('hidden');
        modeHint.classList.remove('hidden');
        
        if (pickerOpen) chemPicker.classList.remove('hidden');
        else chemPicker.classList.add('hidden');
        
        if (guideOpen) labGuide.classList.remove('hidden');
        else labGuide.classList.add('hidden');
        
        // Beaker Visuals
        if (currentReaction && currentReaction.finalColor) {
            beakerLiquid.classList.remove('hidden');
            beakerLiquid.style.backgroundColor = currentReaction.finalColor;
            beakerLabel.innerText = "Reaction Complete";
        } else if (beakerChemical) {
            beakerLiquid.classList.remove('hidden');
            beakerLiquid.style.backgroundColor = getGlowColor(beakerChemical) + '80'; // 50% opacity
            beakerLabel.innerText = beakerChemical;
        } else {
            beakerLiquid.classList.add('hidden');
            beakerLabel.innerText = '';
        }
        
        if (loadedChemical) {
            dropRing.classList.remove('hidden');
        } else {
            dropRing.classList.add('hidden');
        }
        
        // Info Panel Content
        infoIdle.classList.add('hidden');
        infoLoaded.classList.add('hidden');
        infoBeaker.classList.add('hidden');
        infoReaction.classList.add('hidden');
        
        if (currentReaction) {
            infoReaction.classList.remove('hidden');
            document.getElementById('rxn-eq').innerText = currentReaction.equation;
            if (currentReaction.conditions !== 'none') {
                document.getElementById('cond-wrapper').classList.remove('hidden');
                document.getElementById('rxn-cond').innerText = currentReaction.conditions;
            } else {
                document.getElementById('cond-wrapper').classList.add('hidden');
            }
            document.getElementById('rxn-obs').innerText = currentReaction.observation;
            
            const tagLbl = document.getElementById('rxn-tag-lbl');
            const tagDot = document.getElementById('rxn-tag-dot');
            tagLbl.innerText = 'JEE: ' + currentReaction.exam_tag;
            tagDot.className = '';
            if (currentReaction.exam_tag === 'VERY HIGH') tagDot.classList.add('tag-very-high');
            else if (currentReaction.exam_tag === 'HIGH') tagDot.classList.add('tag-high');
            else tagDot.classList.add('tag-moderate');
            
            document.getElementById('rxn-block').innerText = currentReaction.block.replace('_', ' ').toUpperCase();
            

        } else if (loadedChemical) {
            infoLoaded.classList.remove('hidden');
            document.getElementById('loaded-chem-name').innerText = loadedChemical;
        } else if (beakerChemical) {
            infoBeaker.classList.remove('hidden');
            document.getElementById('beaker-chem-name').innerText = beakerChemical;
        } else {
            infoIdle.classList.remove('hidden');
        }
    }
}

function renderPickerTabs() {
    blockTabs.innerHTML = '';
    const blocks = Object.keys(chemicalData.blocks);
    blocks.forEach(blk => {
        const d = document.createElement('div');
        d.className = `tab ${blk === activeBlock ? 'active' : ''}`;
        d.dataset.block = blk;
        d.innerText = blk.replace('_', ' ').toUpperCase();
        blockTabs.appendChild(d);
    });
}

function renderPickerChem() {
    chemGrid.innerHTML = '';
    const chems = chemicalData.blocks[activeBlock] || [];
    chems.forEach(c => {
        const d = document.createElement('div');
        d.className = `chem-pill`;
        d.dataset.chem = c;
        d.innerText = c;
        chemGrid.appendChild(d);
    });
}

function renderPTGrid() {
    ptGrid.innerHTML = '';
    chemicalData.elements.forEach(el => {
        const cell = document.createElement('div');
        cell.className = 'pt-cell';
        cell.dataset.sym = el.symbol;
        cell.style.left = `${(el.group_num - 1) * 5.5}%`;
        
        let topPercent = (el.period - 1) * 14;
        // Add an extra vertical gap before the Lanthanides/Actinides
        if (el.period >= 8) {
            topPercent += 6; 
        }
        cell.style.top = `${topPercent}%`;
        cell.style.borderColor = blockColors[`${el.block}_block`] || '#fff';
        
        const num = document.createElement('div');
        num.className = 'atomic-num';
        num.innerText = el.atomic_number;
        cell.appendChild(num);
        
        const sym = document.createElement('div');
        sym.innerText = el.symbol;
        cell.appendChild(sym);
        
        ptGrid.appendChild(cell);
    });
}

function showPTCard(symbol) {
    const el = chemicalData.elements.find(e => e.symbol === symbol);
    if (!el) return;
    ptCard.classList.remove('hidden');
    document.getElementById('pt-card-symbol').innerText = el.symbol;
    document.getElementById('pt-card-symbol').style.color = blockColors[`${el.block}_block`] || '#fff';
    document.getElementById('pt-card-name').innerText = el.name;
    document.getElementById('pt-card-atomic').innerText = el.atomic_number;
    document.getElementById('pt-card-state').innerText = el.state || 'Unknown';
    document.getElementById('pt-card-color').innerText = el.color || 'Unknown';
    document.getElementById('pt-card-config').innerText = el.electronic_config || el.configuration || 'Unknown';
    document.getElementById('pt-card-block').innerText = `${el.block.toUpperCase()}-Block`;
}

// --- Lab Guide Logic ---
function setupLabGuideTabs() {
    // Mouse click on guide icon toggles guide
    guideIcon.addEventListener('click', () => {
        guideOpen = !guideOpen;
        pickerOpen = false;
        updateUIState();
    });
    
    const tabs = document.querySelectorAll('.guide-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            tabs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            renderLabGuide(e.target.dataset.block);
        });
    });
}

function renderLabGuide(block) {
    const list = document.getElementById('guide-rxn-list');
    list.innerHTML = '';
    
    const filtered = reactionsData.filter(r => r.block === block);
    
    if (filtered.length === 0) {
        list.innerHTML = '<div style="color:var(--dim); font-style:italic; padding:10px;">No simulated reactions for this block yet.</div>';
        return;
    }
    
    filtered.forEach(r => {
        const card = document.createElement('div');
        card.className = 'guide-rxn-card';
        card.dataset.r1 = r.reactant_1;
        card.dataset.r2 = r.reactant_2;
        
        let badgeClass = 'badge-moderate';
        if (r.exam_tag === 'HIGH') badgeClass = 'badge-high';
        if (r.exam_tag === 'VERY HIGH') badgeClass = 'badge-very-high';
        
        card.innerHTML = `
            <div class="rxn-title">${r.reactant_1} + ${r.reactant_2}</div>
            <div class="rxn-obs-preview">${r.observation}</div>
            <div class="rxn-tag-badge ${badgeClass}">${r.exam_tag} YIELD</div>
        `;
        
        card.addEventListener('click', () => {
            // Reset beaker state inline (resetBeaker was never defined)
            beakerChemical = null;
            currentReaction = null;
            currentReactionId = null;
            loadedChemical = null;
            // Now pre-load this reaction
            beakerChemical = r.reactant_1;
            loadedChemical = r.reactant_2;
            guideOpen = false;
            updateUIState();
        });
        
        list.appendChild(card);
    });
}

// --- API Calls ---

async function triggerReaction(c1, c2) {
    const res = await fetch('/api/react', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({chem1: c1, chem2: c2})
    });
    const data = await res.json();
    if (data.reaction) {
        currentReaction = data.reaction;
        currentReactionId = currentReaction.id;
        
        // Extract color from observation for beaker liquid
        const obs = currentReaction.observation.toLowerCase();
        let finalColor = 'rgba(255,255,255,0.5)';
        if (obs.includes('reddish-brown') || obs.includes('brown')) finalColor = 'rgba(165,42,42,0.8)';
        else if (obs.includes('pale blue')) finalColor = 'rgba(173,216,230,0.8)';
        else if (obs.includes('deep blue') || obs.includes('blue')) finalColor = 'rgba(0,100,200,0.8)';
        else if (obs.includes('yellow')) finalColor = 'rgba(255,255,0,0.8)';
        else if (obs.includes('green')) finalColor = 'rgba(0,200,0,0.8)';
        else if (obs.includes('purple')) finalColor = 'rgba(130,0,130,0.8)';
        else if (obs.includes('pink')) finalColor = 'rgba(255,192,203,0.8)';
        
        currentReaction.finalColor = finalColor;
        updateUIState();
    } else {
        // No reaction
        beakerLabel.innerText = "NO REACTION";
        setTimeout(() => {
            beakerLabel.innerText = beakerChemical;
        }, 1000);
    }
}



// Start
init();
