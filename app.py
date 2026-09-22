from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from game_logic import RemiGameState, find_possible_melds_for_bot
import random

app = Flask(__name__)
app.config['SECRET_KEY'] = 'remi_jauh_secret_key_123!'
# Menggunakan async_mode gevent/eventlet atau threading yang dioptimalkan untuk 1 bot ringan
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

rooms = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('create_room')
def handle_create_room(data):
    name = data.get('name', 'Player')
    is_spectator = data.get('is_spectator', False)
    joker_option = int(data.get('joker_option', 0))
    # Batasi maksimal 1 bot agar server tetap ringan dan tidak timeout
    bot_count_option = min(1, int(data.get('bot_count_option', 1)))
    room_code = str(random.randint(1000, 9999))

    game = RemiGameState(room_code, joker_option, bot_count_option)
    game.add_player(request.sid, name, is_spectator)
    rooms[room_code] = game

    join_room(room_code)
    emit('room_created', {
        'room_code': room_code,
        'is_admin': True,
        'is_spectator': is_spectator,
        'players': get_lobby_players(game)
    })

@socketio.on('join_room')
def handle_join_room(data):
    name = data.get('name', 'Player')
    room_code = data.get('room_code')
    is_spectator = data.get('is_spectator', False)

    if room_code not in rooms:
        emit('error_msg', {'message': 'Lobby tidak ditemukan!'})
        return

    game = rooms[room_code]
    if len(game.player_order) >= 4 and not is_spectator:
        emit('error_msg', {'message': 'Lobby penuh! Max 4 pemain.'})
        return

    game.add_player(request.sid, name, is_spectator)
    join_room(room_code)

    is_admin = (game.admin_sid == request.sid)
    emit('room_joined', {
        'room_code': room_code,
        'is_admin': is_admin,
        'is_spectator': is_spectator,
        'players': get_lobby_players(game)
    })
    
    emit('update_lobby', {'players': get_lobby_players(game), 'admin_sid': game.admin_sid}, to=room_code)

@socketio.on('start_game')
def handle_start_game(data):
    room_code = data['room_code']
    if room_code in rooms:
        game = rooms[room_code]
        
        target_players = min(2, len(game.player_order) + game.target_bot_count)
        bot_idx = 1
        while len(game.player_order) < target_players:
            bot_sid = f"bot_{bot_idx}"
            game.add_player(bot_sid, f"Bot {bot_idx}", is_spectator=False)
            game.players[bot_sid]['is_bot'] = True
            bot_idx += 1

        game.game_started = True
        game.reset_game_scores()
        game.start_new_round()
        broadcast_game_state(room_code)
        check_and_trigger_bot(room_code)

@socketio.on('draw_card')
def handle_draw_card(data):
    room_code = data['room_code']
    from_source = data.get('source', 'deck')
    card_id = data.get('card_id')
    selected_hand_card_ids = data.get('selected_hand_card_ids', [])

    if room_code in rooms:
        game = rooms[room_code]
        if from_source == 'deck':
            success, msg = game.draw_from_deck(request.sid)
        else:
            success, msg = game.draw_from_discard(
                request.sid, card_id, 
                selected_hand_card_ids=selected_hand_card_ids
            )

        if not success:
            emit('error_msg', {'message': msg})
        else:
            broadcast_game_state(room_code)
            
@socketio.on('lay_patahan')
def handle_lay_patahan(data):
    room_code = data['room_code']
    card_ids = data['card_ids']

    if room_code in rooms:
        game = rooms[room_code]
        success, msg = game.lay_down_patahan(request.sid, card_ids)
        if not success:
            emit('error_msg', {'message': msg})
        else:
            broadcast_game_state(room_code)

@socketio.on('lay_series')
def handle_lay_series(data):
    room_code = data['room_code']
    card_ids = data['card_ids']

    if room_code in rooms:
        game = rooms[room_code]
        success, msg = game.lay_down_series(request.sid, card_ids)
        if not success:
            emit('error_msg', {'message': msg})
        else:
            broadcast_game_state(room_code)

@socketio.on('discard_card')
def handle_discard(data):
    room_code = data['room_code']
    card_id = data['card_id']
    is_tutupan = data.get('is_tutupan', False)

    if room_code in rooms:
        game = rooms[room_code]
        success, msg, game_ended, details = game.discard_card(request.sid, card_id, is_tutupan)
        
        if not success:
            emit('error_msg', {'message': msg})
        else:
            broadcast_game_state(room_code)
            
            if details is not None:
                emit('round_summary', {
                    'details': details,
                    'game_ended': game_ended,
                    'delay': 5
                }, to=room_code)

                socketio.sleep(5)
                
                if game_ended:
                    game.reset_game_scores()
                    
                game.start_new_round()
                broadcast_game_state(room_code)

            # Pemicu giliran bot tunggal jika giliran berpindah ke bot
            check_and_trigger_bot(room_code)


def check_and_trigger_bot(room_code):
    if room_code not in rooms:
        return
        
    game = rooms[room_code]
    
    if getattr(game, 'is_processing_bots', False):
        return
        
    game.is_processing_bots = True
    
    try:
        if game.game_started and not game.game_over:
            curr_sid = game.get_current_player_sid()
            curr_player = game.players.get(curr_sid, {})
            
            # Jika bukan giliran bot, hentikan
            if not curr_player.get('is_bot'):
                return

            # 1. Bot Bodoh Cangkul dari Dek
            if not game.has_drawn:
                if len(game.deck) > 0:
                    game.draw_from_deck(curr_sid)
                    broadcast_game_state(room_code)
                else:
                    details, game_ended = game.calculate_scores()
                    emit('round_summary', {'details': details, 'game_ended': game_ended, 'delay': 5}, to=room_code)
                    socketio.sleep(2)
                    game.start_new_round()
                    broadcast_game_state(room_code)
                    return

            # 2. Bot Bodoh Langsung Buang Kartu Pertama di Tangan (Tanpa Hitung Kombinasi)
            bot_p = game.players[curr_sid]
            details = None
            if len(bot_p['hand']) > 0:
                card_to_discard = bot_p['hand'][0]['id']
                is_tutupan = (len(bot_p['hand']) == 1)
                
                success, msg, game_ended, details = game.discard_card(curr_sid, card_to_discard, is_tutupan=is_tutupan)

            broadcast_game_state(room_code)

            if details is not None:
                emit('round_summary', {
                    'details': details,
                    'game_ended': game_ended,
                    'delay': 5
                }, to=room_code)
                socketio.sleep(2)
                if game_ended:
                    game.reset_game_scores()
                game.start_new_round()
                broadcast_game_state(room_code)
    finally:
        game.is_processing_bots = False

def get_lobby_players(game):
    return [{'sid': p['sid'], 'name': p['name'], 'is_spectator': p['is_spectator'], 'score': p['score']} for p in game.players.values()]

def broadcast_game_state(room_code):
    game = rooms[room_code]
    curr_turn_sid = game.get_current_player_sid()

    for sid, p in game.players.items():
        if p['is_spectator']:
            state = {
                'is_spectator': True,
                'table_cards': game.discard_pile,
                'deck_count': len(game.deck),
                'players': [{
                    'name': pl['name'],
                    'melds': pl['melds'],
                    'score': pl['score'],
                    'hand_count': len(pl['hand'])
                } for pl_sid, pl in game.players.items() if not pl['is_spectator']],
                'is_my_turn': False
            }
        else:
            state = {
                'is_spectator': False,
                'hand': p['hand'],
                'my_melds': p['melds'],
                'my_score': p['score'],
                'table_cards': game.discard_pile,
                'deck_count': len(game.deck),
                'opponents': [{
                    'name': pl['name'],
                    'melds': pl['melds'],
                    'score': pl['score'],
                    'hand_count': len(pl['hand'])
                } for pl_sid, pl in game.players.items() if pl_sid != sid and not pl['is_spectator']],
                'is_my_turn': (curr_turn_sid == sid),
                'has_drawn': game.has_drawn
            }
        emit('game_update', state, to=sid)

@app.after_request
def add_header(response):
    response.headers['X-Frame-Options'] = 'ALLOWALL'
    
    if request.path.startswith('/static/images/') and (request.path.endswith('.png') or request.path.endswith('.jpg') or request.path.endswith('.jpeg')):
        response.headers['Cache-Control'] = 'public, max-age=604800'
    else:
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        
    return response

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
