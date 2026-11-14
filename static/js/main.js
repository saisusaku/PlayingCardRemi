const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsHost = "playingcardremi.onrender.com"; 
const ws = new WebSocket(`${wsProtocol}${wsHost}`);

let currentRoom = null;
let selectedCards = [];
let myHandCards = []; 
let draggedIndex = null;
let lastDeckCount = null;
let isProcessingUpdate = false; // Mencegah tumpang tindih render penonton

/* =========================================================
   SYSTEM SOUND EFFECT (AUDIO SYNTHESIZER)
   ========================================================= */
let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playSound(type) {
    try {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        const now = ctx.currentTime;

        if (type === 'click') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
            gainNode.gain.setValueAtTime(0.15, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
        } else if (type === 'draw') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(250, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
            gainNode.gain.setValueAtTime(0.2, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        } else if (type === 'success' || type === 'score') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.08);
            osc.frequency.setValueAtTime(783.99, now + 0.16);
            gainNode.gain.setValueAtTime(0.25, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        }
    } catch (e) {
        console.log("Audio play blocked/error:", e);
    }
}

ws.onopen = () => {
    console.log("[WS] Terhubung langsung secara kilat ke server!");
    if (typeof window.notifyServerReady === 'function') {
        window.notifyServerReady();
    }
};

ws.onerror = (err) => {
    console.error("[WS] Koneksi error:", err);
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'room_created') {
        currentRoom = data.room_code;
        document.getElementById('display-room-code').innerText = currentRoom;
        document.getElementById('lobby-room-info').style.display = 'block';
        if(data.is_admin) document.getElementById('start-btn').style.display = 'block';
        playSound('click');
    } 
    else if (data.type === 'room_joined') {
        currentRoom = data.room_code;
        document.getElementById('display-room-code').innerText = currentRoom;
        document.getElementById('lobby-room-info').style.display = 'block';
        playSound('click');
    } 
    else if (data.type === 'update_lobby') {
        const list = document.getElementById('player-list');
        if (list) {
            list.innerHTML = '';
            data.players.forEach(p => {
                const li = document.createElement('li');
                li.innerText = `${p.name} ${p.is_spectator ? '(Penonton)' : ''} - Skor: ${p.score}`;
                list.appendChild(li);
            });
        }
    } 
    else if (data.type === 'game_update') {
        // Cek cangkulan dan atur delay agar bot / penonton tidak terlalu cepat
        if (lastDeckCount !== null && data.deck_count < lastDeckCount) {
            triggerFlyingCardAnimation(data.current_turn_player_id);
        }
        lastDeckCount = data.deck_count;

        // Berikan jeda waktu (throttle/delay) khusus untuk mode penonton atau bot agar gerakan terlihat mulus (tidak ngebut)
        const renderDelay = document.getElementById('is-spectator')?.checked ? 400 : 0;
        
        setTimeout(() => {
            handleGameUpdate(data);
        }, renderDelay);
    } 
    else if (data.type === 'error_msg') {
        alert(data.message);
        selectedCards = [];
        renderHandUI();
    } 
    else if (data.type === 'round_summary') {
        playSound('success');
        handleRoundSummary(data);
    }
};

/* =========================================================
   ANIMASI FLYING CARD (MENGARAH KE PLAYER / SLOT YANG TEPAT)
   ========================================================= */
function triggerFlyingCardAnimation(activePlayerId) {
    playSound('draw');
    
    const deckSource = document.querySelector('.deck-stack') || document.body;
    let targetContainer = document.getElementById('my-hand'); // Default ke bawah (kita)

    // Jika ada ID player aktif dan bukan kita, arahkan ke slot lawan (kiri, atas, atau kanan)
    if (activePlayerId) {
        const slots = ['opponent-left', 'opponent-top', 'opponent-right'];
        // Pilih slot acak / urut dari slot lawan yang tersedia di meja
        const availableSlots = slots.map(id => document.getElementById(id)).filter(el => el && el.children.length > 0);
        if (availableSlots.length > 0) {
            targetContainer = availableSlots[Math.floor(Math.random() * availableSlots.length)];
        }
    }
    
    if (!targetContainer || !deckSource) return;

    const startRect = deckSource.getBoundingClientRect();
    const targetRect = targetContainer.getBoundingClientRect();

    const flyer = document.createElement('div');
    flyer.className = 'flying-card-clone';
    flyer.style.left = `${startRect.left}px`;
    flyer.style.top = `${startRect.top}px`;
    document.body.appendChild(flyer);

    requestAnimationFrame(() => {
        flyer.style.left = `${targetRect.left + (targetRect.width / 2)}px`;
        flyer.style.top = `${targetRect.top + (targetRect.height / 2)}px`;
        flyer.style.transform = 'scale(0.3) rotate(15deg)';
        flyer.style.opacity = '0.2';
    });

    setTimeout(() => {
        flyer.remove();
    }, 500);
}

function createLobby() {
    playSound('click');
    const name = document.getElementById('player-name').value;
    const joker = document.getElementById('joker-option').value;
    const botCount = document.getElementById('bot-count-option').value;
    const isSpec = document.getElementById('is-spectator').checked;
    if(!name) return alert("Masukkan Nama!");
    
    ws.send(JSON.stringify({
        action: 'create_room',
        name: name,
        joker_option: joker,
        bot_count_option: botCount,
        is_spectator: isSpec
    }));
}

function joinLobby() {
    playSound('click');
    const name = document.getElementById('player-name').value;
    const room = document.getElementById('room-code-input').value;
    const isSpec = document.getElementById('is-spectator').checked;
    if(!name || !room) return alert("Isi Nama dan Kode Room!");

    ws.send(JSON.stringify({
        action: 'join_room',
        name: name,
        room_code: room,
        is_spectator: isSpec
    }));
}

function startGame() {
    playSound('click');
    ws.send(JSON.stringify({
        action: 'start_game',
        room_code: currentRoom
    }));
}

function finishRound() {
    playSound('click');
    ws.send(JSON.stringify({
        action: 'finish_round',
        room_code: currentRoom
    }));
}

function handleGameUpdate(state) {
    const lobbyContainer = document.getElementById('lobby-container');
    const gameContainer = document.getElementById('game-container');
    if (lobbyContainer) lobbyContainer.style.display = 'none';
    if (gameContainer) gameContainer.style.display = 'block';
    
    const deckCountEl = document.getElementById('deck-count');
    if (deckCountEl) deckCountEl.innerText = `Sisa: ${state.deck_count}`;
    if (lastDeckCount === null) lastDeckCount = state.deck_count;
    
    const drawBtn = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Cangkul'));
    if (drawBtn) {
        if (state.has_drawn || !state.is_my_turn || state.round_ending) {
            drawBtn.disabled = true;
            drawBtn.style.opacity = '0.5';
            drawBtn.style.cursor = 'not-allowed';
        } else {
            drawBtn.disabled = false;
            drawBtn.style.opacity = '1';
            drawBtn.style.cursor = 'pointer';
        }
    }

    const finishBtn = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Selesai Ronde'));
    if (finishBtn) {
        if (state.round_ending) {
            finishBtn.disabled = false;
            finishBtn.style.opacity = '1';
            finishBtn.style.cursor = 'pointer';
            finishBtn.style.background = '#e67e22';
        } else {
            finishBtn.disabled = true;
            finishBtn.style.opacity = '0.4';
            finishBtn.style.cursor = 'not-allowed';
            finishBtn.style.background = '#7f8c8d';
        }
    }

    const discardDiv = document.getElementById('discard-pile');
    if (discardDiv) {
        discardDiv.innerHTML = '';
        if (state.table_cards && state.table_cards.length > 0) {
            state.table_cards.forEach((card, idx) => {
                const cardEl = renderCardSprite(card);
                cardEl.style.zIndex = idx + 1; 
                if (idx === state.table_cards.length - 1) cardEl.classList.add('top-card');
                
                cardEl.onclick = () => {
                    playSound('click');
                    drawCard('discard', card.id);
                };

                discardDiv.appendChild(cardEl);
            });
            discardDiv.scrollLeft = discardDiv.scrollWidth;
        }
    }

    renderOpponentsPositions(state.opponents || state.players || [], state.current_turn_player_id);

    const playerBottomArea = document.querySelector('.player-bottom');
    if (playerBottomArea) {
        if (state.is_my_turn) {
            playerBottomArea.classList.add('active-turn-glow');
        } else {
            playerBottomArea.classList.remove('active-turn-glow');
        }
    }

    if (state.hand !== undefined) {
        syncAndRenderHand(state.hand);
        renderMyMelds(state.my_melds || []);

        const isMyTurn = state.is_my_turn;
        const myScore = state.my_score !== undefined ? state.my_score : 0;
        
        let statusText = isMyTurn ? "✨ Giliran Anda!" : "⏳ Menunggu Giliran Lawan...";
        if (state.round_ending) {
            statusText = "🔥 TAHAP AKHIR RONDE - Turunkan kartu lalu klik Selesai Ronde!";
        }

        const turnIndicator = document.getElementById('turn-indicator');
        if (turnIndicator) {
            turnIndicator.innerText = statusText + ` | Skor Anda: ${myScore}`;
        }
    }
}

function renderOpponentsPositions(opponents, currentTurnPlayerId) {
    const topSlot = document.getElementById('opponent-top');
    const leftSlot = document.getElementById('opponent-left');
    const rightSlot = document.getElementById('opponent-right');

    if (topSlot) topSlot.innerHTML = '';
    if (leftSlot) leftSlot.innerHTML = '';
    if (rightSlot) rightSlot.innerHTML = '';

    const slots = [leftSlot, topSlot, rightSlot].filter(slot => slot !== null);

    opponents.forEach((op, index) => {
        if (index < slots.length) {
            const opCard = createOpponentCardElement(op, op.id === currentTurnPlayerId);
            slots[index].appendChild(opCard);
        }
    });
}

function createOpponentCardElement(op, isTurn) {
    const opDiv = document.createElement('div');
    opDiv.className = 'opponent-card';
    
    if (isTurn) {
        opDiv.classList.add('active-turn-glow');
    } else {
        opDiv.classList.remove('active-turn-glow');
    }

    opDiv.innerHTML = `<strong>${op.name}</strong> ${isTurn ? '⭐' : ''}<br><small>Tangan: ${op.hand_count || 0} | Skor: ${op.score}</small>`;

    const meldsDiv = document.createElement('div');
    meldsDiv.className = 'melds-row';
    meldsDiv.style.marginTop = '4px';

    if (op.melds && op.melds.series) {
        op.melds.series.forEach(series => {
            const group = document.createElement('div');
            group.className = 'card-stack-horizontal';
            group.style.height = '60px';
            series.forEach((card, idx) => {
                const cEl = renderCardSprite(card);
                cEl.style.transform = 'scale(0.65)';
                cEl.style.margin = '-20px -25px';
                cEl.style.zIndex = idx;
                group.appendChild(cEl);
            });
            meldsDiv.appendChild(group);
        });
    }

    opDiv.appendChild(meldsDiv);
    return opDiv;
}

function renderMyMelds(myMelds) {
    const meldsDiv = document.getElementById('my-melds');
    if(!meldsDiv) return;
    meldsDiv.innerHTML = '';

    if(myMelds) {
        if(myMelds.series) {
            myMelds.series.forEach(series => {
                const group = document.createElement('div');
                group.className = 'card-stack-horizontal';
                series.forEach((card, idx) => {
                    const cEl = renderCardSprite(card);
                    cEl.style.zIndex = idx;
                    group.appendChild(cEl);
                });
                meldsDiv.appendChild(group);
            });
        }
        if(myMelds.patahan) {
            myMelds.patahan.forEach(patahan => {
                const group = document.createElement('div');
                group.className = 'card-stack-horizontal';
                patahan.forEach((card, idx) => {
                    const cEl = renderCardSprite(card);
                    cEl.style.zIndex = idx;
                    group.appendChild(cEl);
                });
                meldsDiv.appendChild(group);
            });
        }
    }
}

function syncAndRenderHand(serverHand) {
    const serverCardIds = serverHand.map(c => c.id);
    myHandCards = myHandCards.filter(c => serverCardIds.includes(c.id));

    serverHand.forEach(serverCard => {
        const exists = myHandCards.some(c => c.id === serverCard.id);
        if (!exists) {
            myHandCards.push(serverCard);
        }
    });

    selectedCards = selectedCards.filter(id => serverCardIds.includes(id));
    renderHandUI();
}

function renderHandUI() {
    const handDiv = document.getElementById('my-hand');
    if (!handDiv) return;
    handDiv.innerHTML = '';

    myHandCards.forEach((card, index) => {
        const cardEl = renderCardSprite(card);
        cardEl.setAttribute('draggable', 'true');
        cardEl.dataset.index = index;

        if (selectedCards.includes(card.id)) {
            cardEl.classList.add('selected');
        }

        cardEl.onclick = () => {
            playSound('click');
            toggleSelectCard(card.id, cardEl);
        };

        cardEl.addEventListener('dragstart', handleDragStart);
        cardEl.addEventListener('dragover', handleDragOver);
        cardEl.addEventListener('drop', handleDrop);
        cardEl.addEventListener('dragend', handleDragEnd);

        handDiv.appendChild(cardEl);
    });
}

function handleDragStart(e) {
    draggedIndex = parseInt(this.dataset.index);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e) {
    e.preventDefault();
    const targetIndex = parseInt(this.dataset.index);
    if (draggedIndex !== null && draggedIndex !== targetIndex) {
        const movedCard = myHandCards.splice(draggedIndex, 1)[0];
        myHandCards.splice(targetIndex, 0, movedCard);
        renderHandUI();
    }
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedIndex = null;
}

function toggleSelectCard(cardId, element) {
    const idx = selectedCards.indexOf(cardId);
    if(idx > -1) {
        selectedCards.splice(idx, 1);
        element.classList.remove('selected');
    } else {
        selectedCards.push(cardId);
        element.classList.add('selected');
    }
}

function drawCard(source, cardId=null) {
    playSound('click');
    if (source === 'deck') {
        ws.send(JSON.stringify({
            action: 'draw_card',
            room_code: currentRoom,
            source: 'deck'
        }));
    } else if (source === 'discard') {
        ws.send(JSON.stringify({
            action: 'draw_card',
            room_code: currentRoom,
            source: 'discard',
            card_id: cardId,
            selected_hand_card_ids: selectedCards
        }));
        
        selectedCards = [];
        renderHandUI();
    }
}

/* =========================================================
   EFEK FLASH & ZOOM SEBELUM KARTU DITURUNKAN
   ========================================================= */
function triggerFlashAndZoomEffect(cardIds, callback) {
    playSound('success');
    cardIds.forEach(id => {
        const cardEls = document.querySelectorAll('.card-sprite');
        cardEls.forEach(el => {
            el.classList.add('anim-flash-zoom');
        });
    });

    setTimeout(() => {
        if (typeof callback === 'function') callback();
    }, 650);
}

function laySeries() {
    if(selectedCards.length < 3) return alert("Pilih minimal 3 kartu untuk Seri!");
    
    triggerFlashAndZoomEffect(selectedCards, () => {
        ws.send(JSON.stringify({
            action: 'lay_series',
            room_code: currentRoom,
            card_ids: selectedCards
        }));
        selectedCards = [];
        renderHandUI();
    });
}

function layPatahan() {
    if (selectedCards.length < 3) return alert("Pilih minimal 3 kartu untuk Patahan!");
    
    triggerFlashAndZoomEffect(selectedCards, () => {
        ws.send(JSON.stringify({
            action: 'lay_patahan',
            room_code: currentRoom,
            card_ids: selectedCards
        }));
        selectedCards = [];
        renderHandUI();
    });
}

function discardSelectedCard(isTutupan) {
    if (selectedCards.length === 0) {
        return alert("Pilih 1 kartu untuk dibuang!");
    }
    playSound('click');
    
    const cardToDiscard = selectedCards[selectedCards.length - 1];
    
    ws.send(JSON.stringify({
        action: 'discard_card',
        room_code: currentRoom,
        card_id: cardToDiscard,
        is_tutupan: isTutupan
    }));
    
    selectedCards = [];
    renderHandUI();
}

function sortHand() {
    playSound('click');
    const rankOrder = {'2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14, 'JOKER':99};
    const suitOrder = {'clubs':1, 'spades':2, 'hearts':3, 'diamonds':4, 'joker':5};

    myHandCards.sort((a, b) => {
        if (suitOrder[a.suit] !== suitOrder[b.suit]) {
            return suitOrder[a.suit] - suitOrder[b.suit];
        }
        return rankOrder[a.rank] - rankOrder[b.rank];
    });

    renderHandUI();
}

const CARD_X_OFFSETS = [
    12, 84, 158, 232, 304, 378, 452, 525, 600, 672, 747, 819, 894, 968
.play
];

const CARD_Y_OFFSETS = [
    9, 109, 209, 311
];

function renderCardSprite(card) {
    const div = document.createElement('div');
    div.className = 'card-sprite';
    
    const posX = -CARD_X_OFFSETS[card.sprite_col]; 
    const posY = -CARD_Y_OFFSETS[card.sprite_row];
    
    div.style.backgroundPosition = `${posX}px ${posY}px`;
    return div;
}

function handleRoundSummary(data) {
    const modal = document.getElementById('score-modal');
    const tbody = document.getElementById('modal-score-body');
    const title = document.getElementById('modal-title');
    const timerSpan = document.getElementById('countdown-timer');

    if (!modal) return;

    tbody.innerHTML = '';
    
    // RULE: Cek apakah ada pemain yang mencapai skor <= -500 atau game_ended dari server
    let maxScore = -Infinity;
    let winnerName = "";
    let isGameOver = data.game_ended || false;

    data.details.forEach(d => {
        // Cari skor tertinggi untuk juara 1
        if (d.accumulated_score > maxScore) {
            maxScore = d.accumulated_score;
            winnerName = d.name;
        }
        // Jika ada player yang akumulasi skornya menyentuh atau melewati -500
        if (d.accumulated_score <= -500) {
            isGameOver = true;
        }
    });

    if(isGameOver) {
        title.innerText = `🏆 PERMAINAN SELESAI! JUARA 1: ${winnerName} (Skor Tertinggi: ${maxScore})`;
    } else {
        title.innerText = "🎯 HASIL RONDE & PERHITUNGAN SKOR";
    }

    data.details.forEach(d => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #333';
        if(d.accumulated_score === maxScore && isGameOver) {
            tr.style.background = 'rgba(241, 196, 15, 0.2)'; // Highlight Juara 1
        } else if(d.is_winner) {
            tr.style.background = 'rgba(39, 174, 96, 0.2)';
        }

        tr.innerHTML = `
            <td style="padding:8px; text-align:left;"><strong>${d.name}</strong> ${d.accumulated_score === maxScore && isGameOver ? '👑 [JUARA 1]' : (d.is_winner ? '✨' : '')}</td>
            <td style="padding:8px; color:#2ecc71;">+${d.pts_down}</td>
            <td style="padding:8px; color:#e74c3c;">${d.pts_hand}</td>
            <td style="padding:8px; color:#f1c40f;">+${d.bonus_tutupan}</td>
            <td style="padding:8px;">${d.round_total}</td>
            <td style="padding:8px; font-weight:bold; color:${d.accumulated_score <= -500 ? '#e74c3c' : '#2ecc71'};">${d.accumulated_score}</td>
        `;
        tbody.appendChild(tr);
    });

    modal.style.display = 'flex';

    let timeLeft = data.delay || 5;
    if (isGameOver) timeLeft = 15; // Beri waktu lebih lama di layar akhir game
    timerSpan.innerText = timeLeft;
    
    const interval = setInterval(() => {
        timeLeft -= 1;
        if(timeLeft >= 0) {
            timerSpan.innerText = timeLeft;
        }
        if (timeLeft <= 0) {
            clearInterval(interval);
            if (!isGameOver) {
                modal.style.display = 'none';
            }
        }
    }, 1000);
}
