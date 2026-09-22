import random

SUITS = ['clubs', 'spades', 'hearts', 'diamonds']
RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

CARD_VALUES = {
    '2': 5, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5, '8': 5, '9': 5, '10': 5,
    'J': 10, 'Q': 10, 'K': 10, 'A': 15, 'JOKER': -25
}

NUMERIC_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10']
NUMERIC_ORDER = {rank: idx for idx, rank in enumerate(NUMERIC_RANKS)}

FACE_RANKS = ['J', 'Q', 'K']
FACE_ORDER = {rank: idx for idx, rank in enumerate(FACE_RANKS)}


def create_deck(joker_count=0):
    deck = []
    for suit_idx, suit in enumerate(SUITS):
        for rank_idx, rank in enumerate(RANKS):
            deck.append({
                'id': f"{suit}_{rank}",
                'suit': suit,
                'rank': rank,
                'type': 'normal',
                'sprite_col': rank_idx + 1,
                'sprite_row': suit_idx
            })
    
    for i in range(joker_count):
        deck.append({
            'id': f"joker_{i+1}",
            'suit': 'joker',
            'rank': 'JOKER',
            'type': 'joker',
            'sprite_col': 0,
            'sprite_row': 1 if i % 2 == 0 else 2
        })
        
    random.shuffle(deck)
    return deck


def is_valid_run_series(cards):
    if len(cards) < 3:
        return False
    
    normals = [c for c in cards if c['type'] == 'normal']
    jokers = [c for c in cards if c['type'] == 'joker']
    
    if len(normals) == 0:
        return False

    if any(c['rank'] == 'A' for c in normals):
        return False

    same_suit = all(c['suit'] == normals[0]['suit'] for c in normals)
    if not same_suit:
        return False

    all_numeric = all(c['rank'] in NUMERIC_RANKS for c in normals)
    if all_numeric:
        sorted_cards = sorted(normals, key=lambda c: NUMERIC_ORDER[c['rank']])
        gaps = 0
        for i in range(len(sorted_cards) - 1):
            diff = NUMERIC_ORDER[sorted_cards[i+1]['rank']] - NUMERIC_ORDER[sorted_cards[i]['rank']] - 1
            if diff < 0:
                return False
            gaps += diff
        return gaps <= len(jokers)

    all_face = all(c['rank'] in FACE_RANKS for c in normals)
    if all_face:
        sorted_cards = sorted(normals, key=lambda c: FACE_ORDER[c['rank']])
        gaps = 0
        for i in range(len(sorted_cards) - 1):
            diff = FACE_ORDER[sorted_cards[i+1]['rank']] - FACE_ORDER[sorted_cards[i]['rank']] - 1
            if diff < 0:
                return False
            gaps += diff
        return gaps <= len(jokers)

    return False


def is_valid_patahan_set(cards):
    if len(cards) < 3:
        return False
    
    normals = [c for c in cards if c['type'] == 'normal']
    if len(normals) == 0:
        return False

    same_rank = all(c['rank'] == normals[0]['rank'] for c in normals)
    if same_rank:
        suits = [c['suit'] for c in normals]
        if len(suits) == len(set(suits)):
            return True

    return False


def find_possible_melds_for_bot(hand, has_existing_series=False):
    from itertools import combinations
    
    for r in range(len(hand), 2, -1):
        for combo in combinations(hand, r):
            if is_valid_run_series(list(combo)):
                return 'series', [c['id'] for c in combo]

    for r in range(len(hand), 2, -1):
        for combo in combinations(hand, r):
            combo_list = list(combo)
            if is_valid_patahan_set(combo_list):
                is_four_aces = (len(combo_list) == 4 and all(c['rank'] == 'A' for c in combo_list))
                if has_existing_series or is_four_aces:
                    return 'patahan', [c['id'] for c in combo]

    return None, None


class RemiGameState:
    def __init__(self, room_id, joker_option=0, target_bot_count=3):
        self.room_id = room_id
        self.joker_option = joker_option
        self.target_bot_count = target_bot_count
        self.deck = []
        self.discard_pile = []
        self.players = {}
        self.player_order = []
        self.spectators = []
        self.current_turn_index = 0
        self.game_started = False
        self.game_over = False
        self.first_round = True
        self.highest_scorer_prev = None
        self.has_drawn = False
        self.starter_must_discard = False
        self.admin_sid = None

    def add_player(self, sid, name, is_spectator=False):
        if not self.admin_sid:
            self.admin_sid = sid

        if is_spectator:
            self.spectators.append(sid)
            self.players[sid] = {
                'sid': sid, 'name': name, 'is_spectator': True,
                'hand': [], 'melds': {'series': [], 'patahan': []},
                'score': 0, 'is_bot': False
            }
        else:
            self.player_order.append(sid)
            self.players[sid] = {
                'sid': sid, 'name': name, 'is_spectator': False,
                'hand': [], 'melds': {'series': [], 'patahan': []},
                'score': 0, 'is_bot': False
            }

    def reset_game_scores(self):
        for p in self.players.values():
            p['score'] = 0
        self.first_round = True
        self.highest_scorer_prev = None

    def start_new_round(self):
        self.deck = create_deck(self.joker_option)
        self.discard_pile = []

        for sid in self.player_order:
            self.players[sid]['hand'] = []
            self.players[sid]['melds'] = {'series': [], 'patahan': []}

        if self.first_round or not self.highest_scorer_prev or self.highest_scorer_prev not in self.player_order:
            start_idx = random.randint(0, len(self.player_order) - 1)
        else:
            start_idx = self.player_order.index(self.highest_scorer_prev)

        self.current_turn_index = start_idx
        starter_sid = self.player_order[start_idx]

        for sid in self.player_order:
            # Semua pemain awal mendapatkan 7 kartu standar terlebih dahulu
            count = 7
            for _ in range(count):
                if self.deck:
                    self.players[sid]['hand'].append(self.deck.pop())

        # KHUSUS PEMAIN PERTAMA (STARTER): Mendapatkan kartu ke-8
        starter_player = self.players[starter_sid]
        if self.deck:
            starter_player['hand'].append(self.deck.pop())

        # KEMBALIKAN KE TRUE: Karena pemain pertama sudah memegang 8 kartu, 
        # dia dianggap "sudah punya kartu jalan" dan siap membuang atau menurunkan meld tanpa cangkul lagi.
        self.has_drawn = True
        self.starter_must_discard = True

    def get_current_player_sid(self):
        if not self.player_order:
            return None
        return self.player_order[self.current_turn_index]

    def next_turn(self):
        self.has_drawn = False
        self.starter_must_discard = False
        self.current_turn_index = (self.current_turn_index + 1) % len(self.player_order)

    def draw_from_deck(self, sid):
        if self.get_current_player_sid() != sid:
            return False, "Bukan giliran Anda!"
        if self.has_drawn:
            return False, "Anda sudah mengambil kartu pada giliran ini!"
        if len(self.deck) == 0:
            return False, "Cangkulan sudah habis!"
        
        card = self.deck.pop()
        self.players[sid]['hand'].append(card)
        self.has_drawn = True
        return True, "Kartu berhasil dicangkul."

    def draw_from_discard(self, sid, card_id, selected_hand_card_ids=None):
        if self.get_current_player_sid() != sid:
            return False, "Bukan giliran Anda!"
        if self.has_drawn:
            return False, "Anda sudah mengambil kartu pada giliran ini!"

        card_indices = [i for i, c in enumerate(self.discard_pile) if c['id'] == card_id]
        if not card_indices:
            return False, "Kartu tidak ditemukan di meja!"

        idx = card_indices[0]
        target_card = self.discard_pile[idx]
        cards_to_take = self.discard_pile[idx:]

        if len(cards_to_take) > 7:
            return False, "Hanya bisa mengambil maksimal 7 kartu dari meja!"

        if any(c['type'] == 'joker' for c in cards_to_take):
            return False, "Kartu Joker di meja tidak boleh diambil!"

        p = self.players[sid]
        selected_hand_cards = [c for c in p['hand'] if c['id'] in (selected_hand_card_ids or [])]
        
        # GABUNGKAN KARTU DI TANGAN DAN KARTU DARI MEJA
        meld_combination = selected_hand_cards + [target_card]

        detected_meld_type = None

        # PERBAIKAN: Urutkan terlebih dahulu kombinasi kartu numerik sebelum divalidasi 
        # agar susunan acak dari player (misal 5, 3, 4 + 6) terbaca sah menjadi (3, 4, 5, 6)
        sorted_meld_for_check = sorted(meld_combination, key=lambda c: NUMERIC_ORDER.get(c['rank'], 0) if c['type'] == 'normal' else 99)

        if is_valid_patahan_set(meld_combination):
            has_existing_series = len(p['melds']['series']) > 0
            is_four_aces = (len(meld_combination) == 4 and all(c['rank'] == 'A' for c in meld_combination))
            if has_existing_series or is_four_aces:
                detected_meld_type = 'patahan'
            else:
                return False, "Untuk Patahan harus sudah ada Seri Murni terlebih dahulu!"
        elif is_valid_run_series(sorted_meld_for_check):  # Validasi menggunakan list yang sudah terurut
            detected_meld_type = 'series'
        else:
            return False, "Kombinasi tidak sah!"

        # SIMULASI KARTU SISA
        meld_ids = [c['id'] for c in meld_combination]
        simulated_hand = [c for c in p['hand'] if c['id'] not in meld_ids] + cards_to_take
        if len(simulated_hand) == 0:
            return False, "Kartu di tangan harus menyisakan minimal 1 kartu untuk dibuang setelah mengambil dari meja!"

        self.players[sid]['hand'].extend(cards_to_take)
        self.discard_pile = self.discard_pile[:idx]
        self.has_drawn = True

        self.players[sid]['hand'] = [c for c in self.players[sid]['hand'] if c['id'] not in meld_ids]
        
        if detected_meld_type == 'series':
            self.players[sid]['melds']['series'].append(sorted_meld_for_check)
        elif detected_meld_type == 'patahan':
            self.players[sid]['melds']['patahan'].append(meld_combination)

        return True, f"Berhasil mengambil {len(cards_to_take)} kartu dari meja!"

    def lay_down_series(self, sid, card_ids):
        p = self.players[sid]
        selected_cards = [c for c in p['hand'] if c['id'] in card_ids]

        if not is_valid_run_series(selected_cards):
            return False, "Seri tidak sah!"

        p['hand'] = [c for c in p['hand'] if c['id'] not in card_ids]
        p['melds']['series'].append(selected_cards)
        return True, "Seri Murni berhasil diturunkan!"

    def lay_down_patahan(self, sid, card_ids):
        p = self.players[sid]
        selected_cards = [c for c in p['hand'] if c['id'] in card_ids]

        has_existing_series = len(p['melds']['series']) > 0
        is_four_aces = (len(selected_cards) == 4 and all(c['rank'] == 'A' for c in selected_cards))

        if not has_existing_series and not is_four_aces:
            return False, "Anda harus menurunkan Seri Murni terlebih dahulu sebelum Patahan!"

        if not is_valid_patahan_set(selected_cards):
            return False, "Kombinasi kartu bukan Patahan yang sah!"

        p['hand'] = [c for c in p['hand'] if c['id'] not in card_ids]
        p['melds']['patahan'].append(selected_cards)
        return True, "Patahan berhasil diturunkan!"

    def discard_card(self, sid, card_id, is_tutupan=False):
        if self.get_current_player_sid() != sid:
            return False, "Bukan giliran Anda!", False, None

        p = self.players[sid]
        
        # Izinkan pembuangan jika sudah draw ATAU jika ini adalah giliran pertama pemain starter (starter_must_discard)
        if not self.has_drawn and not self.starter_must_discard and not p.get('is_bot', False):
            return False, "Anda harus cangkul atau mengambil kartu terlebih dahulu sebelum membuang!", False, None

        if card_id == "auto_bot" and p.get('is_bot'):
            if len(p['hand']) > 0:
                card = p['hand'][0]
            else:
                return False, "Tangan bot kosong!", False, None
        else:
            card = next((c for c in p['hand'] if c['id'] == card_id), None)
            if not card:
                return False, "Kartu tidak ada di tangan!", False, None

        p['hand'] = [c for c in p['hand'] if c['id'] != card['id']]

        if is_tutupan or len(p['hand']) == 0:
            details, game_ended = self.calculate_scores(winner_sid=sid, tutupan_card=card)
            return True, "Permainan Selesai (Tutupan)!", game_ended, details

        self.discard_pile.append(card)

        if len(self.deck) == 0:
            details, game_ended = self.calculate_scores()
            return True, "Permainan Selesai (Cangkulan Habis)!", game_ended, details

        # Reset flag starter_must_discard setelah giliran pertama selesai
        self.starter_must_discard = False
        self.next_turn()
        return True, "Kartu dibuang.", False, None

    def calculate_scores(self, winner_sid=None, tutupan_card=None):
        score_details = []
        
        for sid in self.player_order:
            p = self.players[sid]
            pts_down = 0
            pts_hand = 0
            bonus_tutupan = 0
            
            for s in p['melds']['series']:
                for card in s:
                    pts_down += CARD_VALUES.get(card['rank'], 5)
            for pt in p['melds']['patahan']:
                for card in pt:
                    pts_down += CARD_VALUES.get(card['rank'], 5)
            
            for card in p['hand']:
                if card['type'] == 'joker':
                    pts_hand -= 25
                else:
                    pts_hand -= CARD_VALUES.get(card['rank'], 5)

            if winner_sid and sid == winner_sid and tutupan_card:
                val = CARD_VALUES.get(tutupan_card['rank'], 5)
                if tutupan_card['type'] == 'joker':
                    val = 25
                bonus_tutupan = val * 10

            round_total = pts_down + pts_hand + bonus_tutupan
            p['score'] += round_total
            
            score_details.append({
                'name': p['name'],
                'pts_down': pts_down,
                'pts_hand': pts_hand,
                'bonus_tutupan': bonus_tutupan,
                'round_total': round_total,
                'accumulated_score': p['score'],
                'is_winner': (sid == winner_sid)
            })

        highest_player = max(self.players.values(), key=lambda x: x['score'])
        self.highest_scorer_prev = highest_player['sid']
        self.first_round = False
        
        game_ended = any(p['score'] >= 500 for p in self.players.values() if not p['is_spectator'])
        return score_details, game_ended
