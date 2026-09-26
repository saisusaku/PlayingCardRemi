const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsHost = "playingcardremi.onrender.com"; 
const ws = new WebSocket(`${wsProtocol}${wsHost}`);

let currentRoom = null;
let selectedCards = [];
let myHandCards = []; 
let draggedIndex = null;

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
    } 
    else if (data.type === 'room_joined') {
        currentRoom = data.room_code;
        document.getElementById('display-room-code').innerText = currentRoom;
        document.getElementById('lobby-room-info').style.display = 'block';
    } 
    else if (data.type === 'update_lobby') {
        const list = document.getElementById('player-list');
        list.innerHTML = '';
        data.players.forEach(p => {
            const li = document.createElement('li');
            li.innerText = `${p.name} ${p.is_spectator ? '(Penonton)' : ''} - Skor: ${p.score}`;
            list.appendChild(li);
        });
    } 
    else if (data.type === 'game_update') {
        handleGameUpdate(data);
    } 
    else if (data.type === 'error_msg') {
        alert(data.message);
    } 
    else if (data.type === 'round_summary') {
        handleRoundSummary(data);
    }
};

function createLobby() {
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
    ws.send(JSON.stringify({
        action: 'start_game',
        room_code: currentRoom
    }));
}

function handleGameUpdate(state) {
    document.getElementById('lobby-container').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    document.getElementById('deck-count').innerText = `Sisa: ${state.deck_count}`;
    
    const drawBtn = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Cangkul'));
    if (drawBtn) {
        if (state.has_drawn || !state.is_my_turn) {
            drawBtn.disabled = true;
            drawBtn.style.opacity = '0.5';
            drawBtn.style.cursor = 'not-allowed';
        } else {
            drawBtn.disabled = false;
            drawBtn.style.opacity = '1';
            drawBtn.style.cursor = 'pointer';
        }
    }

    const discardDiv = document.getElementById('discard-pile');
    discardDiv.innerHTML = '';

    if (state.table_cards && state.table_cards.length > 0) {
        state.table_cards.forEach((card, idx) => {
            const cardEl = renderCardSprite(card);
            cardEl.style.zIndex = idx + 1; 
            if (idx === state.table_cards.length - 1) cardEl.classList.add('top-card');
            
            cardEl.onclick = () => {
                if (idx === state.table_cards.length - 1) {
                    drawCard('discard', card.id);
                } else {
                    drawCard('discard', card.id);
                }
            };

            discardDiv.appendChild(cardEl);
        });
        discardDiv.scrollLeft = discardDiv.scrollWidth;
    }

    renderOpponentsPositions(state.opponents || state.players || []);

    if (state.hand !== undefined) {
        syncAndRenderHand(state.hand);
        renderMyMelds(state.my_melds || []);

        const isMyTurn = state.is_my_turn;
        const myScore = state.my_score !== undefined ? state.my_score : 0;
        
        document.getElementById('turn-indicator').innerText = 
            (isMyTurn ? "Giliran Anda!" : "Menunggu Giliran Bot...") + ` | Skor Anda: ${myScore}`;
    }
}

function renderOpponentsPositions(opponents) {
    const topSlot = document.getElementById('opponent-top');
    const leftSlot = document.getElementById('opponent-left');
    const rightSlot = document.getElementById('opponent-right');

    if (topSlot) topSlot.innerHTML = '';
    if (leftSlot) leftSlot.innerHTML = '';
    if (rightSlot) rightSlot.innerHTML = '';

    const slots = [leftSlot, topSlot, rightSlot].filter(slot => slot !== null);

    opponents.forEach((op, index) => {
        if (index < slots.length) {
            const opCard = createOpponentCardElement(op);
            slots[index].appendChild(opCard);
        }
    });
}

function createOpponentCardElement(op) {
    const opDiv = document.createElement('div');
    opDiv.className = 'opponent-card';
    opDiv.innerHTML = `<strong>${op.name}</strong><br><small>Tangan: ${op.hand_count || 0} | Skor: ${op.score}</small>`;

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
    handDiv.innerHTML = '';

    myHandCards.forEach((card, index) => {
        const cardEl = renderCardSprite(card);
        cardEl.setAttribute('draggable', 'true');
        cardEl.dataset.index = index;

        if (selectedCards.includes(card.id)) {
            cardEl.classList.add('selected');
        }

        cardEl.onclick = () => toggleSelectCard(card.id, cardEl);

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
    }
}

function laySeries() {
    if(selectedCards.length < 3) return alert("Pilih minimal 3 kartu untuk Seri!");
    ws.send(JSON.stringify({
        action: 'lay_series',
        room_code: currentRoom,
        card_ids: selectedCards
    }));
    selectedCards = [];
}

function layPatahan() {
    if (selectedCards.length < 3) return alert("Pilih minimal 3 kartu untuk Patahan!");
    ws.send(JSON.stringify({
        action: 'lay_patahan',
        room_code: currentRoom,
        card_ids: selectedCards
    }));
    selectedCards = [];
}

function discardSelectedCard(isTutupan) {
    if (selectedCards.length === 0) {
        return alert("Pilih 1 kartu untuk dibuang!");
    }
    
    const cardToDiscard = selectedCards[selectedCards.length - 1];
    
    ws.send(JSON.stringify({
        action: 'discard_card',
        room_code: currentRoom,
        card_id: cardToDiscard,
        is_tutupan: isTutupan
    }));
    
    selectedCards = [];
}

function sortHand() {
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

    tbody.innerHTML = '';
    
    if(data.game_ended) {
        title.innerText = "🏆 PERMAINAN SELESAI (MEMENANGKAN 500 PTS)!";
    } else {
        title.innerText = "📋 HASIL RONDE & PERHITUNGAN SKOR";
    }

    data.details.forEach(d => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #333';
        if(d.is_winner) tr.style.background = 'rgba(39, 174, 96, 0.2)';

        tr.innerHTML = `
            <td style="padding:8px; text-align:left;"><strong>${d.name}</strong> ${d.is_winner ? '👑' : ''}</td>
            <td style="padding:8px; color:#2ecc71;">+${d.pts_down}</td>
            <td style="padding:8px; color:#e74c3c;">${d.pts_hand}</td>
            <td style="padding:8px; color:#f1c40f;">+${d.bonus_tutupan}</td>
            <td style="padding:8px;">${d.round_total}</td>
            <td style="padding:8px; font-weight:bold; color:#2ecc71;">${d.accumulated_score}</td>
        `;
        tbody.appendChild(tr);
    });

    modal.style.display = 'flex';

    let timeLeft = data.delay || 5;
    timerSpan.innerText = timeLeft;
    
    const interval = setInterval(() => {
        timeLeft -= 1;
        if(timeLeft >= 0) {
            timerSpan.innerText = timeLeft;
        }
        if (timeLeft <= 0) {
            clearInterval(interval);
            modal.style.display = 'none';
        }
    }, 1000);
}
