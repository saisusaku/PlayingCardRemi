import asyncio
import json
import random
import os
import websockets
from game_logic import RemiGameState, find_possible_melds_for_bot

rooms = {}

async def process_bot_turns(room_code):
    """Fungsi otomatis untuk menjalankan giliran bot secara cerdas di server"""
    await asyncio.sleep(1.5)  # Beri jeda agar pemain sempat melihat pergerakan di meja
    while room_code in rooms:
        game = rooms[room_code]
        if not game.game_started or game.game_over:
            break
            
        curr_sid = game.get_current_player_sid()
        curr_player = game.players.get(curr_sid)
        
        if not curr_player or not curr_player.get('is_bot', False):
            break  # Jika giliran pemain manusia, hentikan loop bot

        # 1. Fase Mengambil Kartu (Cangkul)
        if game.starter_must_discard:
            pass  # Pemain pertama sudah memegang 8 kartu dari awal, lewati cangkul
        else:
            success, _ = game.draw_from_deck(curr_sid)
            if success:
                await broadcast_game_state(room_code)
                await asyncio.sleep(1.0)

        # 2. Fase Cerdas Bot Menurunkan Melds (Seri / Patahan) secara berulang jika ada yang valid
        while True:
            has_series = len(curr_player['melds']['series']) > 0
            m_type, m_ids, m_cards = find_possible_melds_for_bot(curr_player['hand'], has_series)
            if not m_type:
                break
            
            # Eksekusi penurunan meld bot ke meja
            if m_type == 'series':
                curr_player['hand'] = [c for c in curr_player['hand'] if c['id'] not in m_ids]
                curr_player['melds']['series'].append(m_cards)
            elif m_type == 'patahan':
                curr_player['hand'] = [c for c in curr_player['hand'] if c['id'] not in m_ids]
                curr_player['melds']['patahan'].append(m_cards)
            
            await broadcast_game_state(room_code)
            await asyncio.sleep(0.8)

        # 3. Fase Membuang Kartu atau Tutupan (Menang)
        if curr_player['hand']:
            # Bot mengecek apakah bisa Tutup (sisa 1 kartu di tangan dan sudah punya minimal 1 seri)
            can_close = (len(curr_player['hand']) == 1 and len(curr_player['melds']['series']) > 0)
            
            card_to_discard = curr_player['hand'][0]
            success, _, game_ended, details = game.discard_card(curr_sid, card_to_discard['id'], is_tutupan=can_close)
            
            await broadcast_game_state(room_code)
            
            # Jika bot melakukan tutupan, permainan masuk ke round_ending, bot otomatis klik finish round
            if game.round_ending:
                details, game_ended = game.finish_round_scoring()
                summary_data = {
                    'type': 'round_summary',
                    'details': details,
                    'game_ended': game_ended,
                    'delay': 5
                }
                for ws in game.active_webs.values():
                    try:
                        await ws.send(json.dumps(summary_data))
                    except:
                        pass
                if game_ended:
                    game.reset_game_scores()
                game.start_new_round()
                await broadcast_game_state(room_code)

            # Cek ulang apakah giliran berikutnya langsung bot lagi
            next_sid = game.get_current_player_sid()
            if game.players.get(next_sid, {}).get('is_bot', False):
                continue
            else:
                break
        await asyncio.sleep(1.5)

async def broadcast_game_state(room_code):
    if room_code in rooms:
        game = rooms[room_code]
        for sid, ws in list(game.active_webs.items()):
            try:
                p = game.players.get(sid)
                if not p:
                    continue
                
                curr_turn_sid = game.get_current_player_sid()
                
                if p['is_spectator']:
                    state = {
                        "type": "game_update",
                        "is_spectator": True,
                        "table_cards": game.discard_pile,
                        "deck_count": len(game.deck),
                        "players": [{
                            'name': pl['name'],
                            'melds': pl['melds'],
                            'score': pl['score'],
                            'hand_count': len(pl['hand'])
                        } for pl_sid, pl in game.players.items() if not pl['is_spectator']],
                        "is_my_turn": False,
                        "round_ending": game.round_ending,
                        "game_started": game.game_started,
                        "game_over": game.game_over
                    }
                else:
                    state = {
                        "type": "game_update",
                        "is_spectator": False,
                        "hand": p['hand'],
                        "my_melds": p['melds'],
                        "my_score": p['score'],
                        "table_cards": game.discard_pile,
                        "deck_count": len(game.deck),
                        "opponents": [{
                            'name': pl['name'],
                            'melds': pl['melds'],
                            'score': pl['score'],
                            'hand_count': len(pl['hand'])
                        } for pl_sid, pl in game.players.items() if pl_sid != sid and not pl['is_spectator']],
                        "is_my_turn": (curr_turn_sid == sid),
                        "has_drawn": game.has_drawn,
                        "round_ending": game.round_ending,  # <-- PENTING AGAR TOMBOL SELESAI AKTIF DI CLIENT
                        "game_started": game.game_started,
                        "game_over": game.game_over,
                        "current_turn_sid": curr_turn_sid
                    }
                await ws.send(json.dumps(state))
            except:
                game.active_webs.pop(sid, None)
                
        # Jika giliran saat ini adalah bot, jalankan proses bot secara asynchronous di latar belakang server
        curr_sid = game.get_current_player_sid()
        curr_player = game.players.get(curr_sid)
        if curr_player and curr_player.get('is_bot', False):
            asyncio.create_task(process_bot_turns(room_code))

async def handler(websocket):
    player_sid = str(id(websocket))
    current_room_code = None

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue

            action = data.get("action")

            if action == "create_room":
                name = data.get("name", "Player")
                is_spectator = data.get("is_spectator", False)
                joker_option = int(data.get("joker_option", 0))
                bot_count_option = min(3, max(0, int(data.get("bot_count_option", 1))))
                room_code = str(random.randint(1000, 9999))

                game = RemiGameState(room_code, joker_option, bot_count_option)
                game.active_webs = {player_sid: websocket}
                game.add_player(player_sid, name, is_spectator)
                rooms[room_code] = game
                current_room_code = room_code

                await websocket.send(json.dumps({
                    "type": "room_created",
                    "room_code": room_code,
                    "is_admin": True,
                    "is_spectator": is_spectator,
                    "players": [{'sid': p['sid'], 'name': p['name'], 'is_spectator': p['is_spectator'], 'score': p['score']} for p in game.players.values()]
                }))

            elif action == "join_room":
                name = data.get("name", "Player")
                room_code = data.get("room_code")
                is_spectator = data.get("is_spectator", False)

                if room_code not in rooms:
                    await websocket.send(json.dumps({"type": "error_msg", "message": "Lobby tidak ditemukan!"}))
                    continue

                game = rooms[room_code]
                if len(game.player_order) >= 4 and not is_spectator:
                    await websocket.send(json.dumps({"type": "error_msg", "message": "Lobby penuh! Max 4 pemain."}))
                    continue

                game.active_webs[player_sid] = websocket
                game.add_player(player_sid, name, is_spectator)
                current_room_code = room_code

                is_admin = (game.admin_sid == player_sid)
                await websocket.send(json.dumps({
                    "type": "room_joined",
                    "room_code": room_code,
                    "is_admin": is_admin,
                    "is_spectator": is_spectator,
                    "players": [{'sid': p['sid'], 'name': p['name'], 'is_spectator': p['is_spectator'], 'score': p['score']} for p in game.players.values()]
                }))

                lobby_data = {'type': 'update_lobby', 'players': [{'sid': p['sid'], 'name': p['name'], 'is_spectator': p['is_spectator'], 'score': p['score']} for p in game.players.values()], 'admin_sid': game.admin_sid}
                for ws in game.active_webs.values():
                    await ws.send(json.dumps(lobby_data))

            elif action == "start_game":
                room_code = data.get("room_code")
                if room_code in rooms:
                    game = rooms[room_code]
                    target_players = min(4, len(game.player_order) + game.target_bot_count)
                    bot_idx = 1
                    while len(game.player_order) < target_players:
                        bot_sid = f"bot_{bot_idx}"
                        game.add_player(bot_sid, f"Bot {bot_idx}", is_spectator=False)
                        game.players[bot_sid]['is_bot'] = True
                        bot_idx += 1

                    game.game_started = True
                    game.reset_game_scores()
                    game.start_new_round()
                    await broadcast_game_state(room_code)

                    curr_sid = game.get_current_player_sid()
                    if game.players.get(curr_sid, {}).get('is_bot', False):
                        asyncio.create_task(process_bot_turns(room_code))

            elif action == "draw_card":
                room_code = data.get("room_code")
                from_source = data.get("source", "deck")
                card_id = data.get("card_id")
                selected_hand_card_ids = data.get("selected_hand_card_ids", [])

                if room_code in rooms:
                    game = rooms[room_code]
                    if from_source == 'deck':
                        success, msg = game.draw_from_deck(player_sid)
                    else:
                        success, msg = game.draw_from_discard(player_sid, card_id, selected_hand_card_ids)

                    if not success:
                        await websocket.send(json.dumps({"type": "error_msg", "message": msg}))
                    else:
                        await broadcast_game_state(room_code)

            elif action == "lay_series":
                room_code = data.get("room_code")
                card_ids = data.get("card_ids", [])
                if room_code in rooms:
                    game = rooms[room_code]
                    success, msg = game.lay_down_series(player_sid, card_ids)
                    if not success:
                        await websocket.send(json.dumps({"type": "error_msg", "message": msg}))
                    else:
                        await broadcast_game_state(room_code)

            elif action == "lay_patahan":
                room_code = data.get("room_code")
                card_ids = data.get("card_ids", [])
                if room_code in rooms:
                    game = rooms[room_code]
                    success, msg = game.lay_down_patahan(player_sid, card_ids)
                    if not success:
                        await websocket.send(json.dumps({"type": "error_msg", "message": msg}))
                    else:
                        await broadcast_game_state(room_code)

            elif action == "discard_card":
                room_code = data.get("room_code")
                card_id = data.get("card_id")
                is_tutupan = data.get("is_tutupan", False)

                if room_code in rooms:
                    game = rooms[room_code]
                    success, msg, game_ended, details = game.discard_card(player_sid, card_id, is_tutupan)

                    if not success:
                        await websocket.send(json.dumps({"type": "error_msg", "message": msg}))
                    else:
                        await broadcast_game_state(room_code)

            elif action == "finish_round":
                room_code = data.get("room_code")
                if room_code in rooms:
                    game = rooms[room_code]
                    if game.round_ending:
                        details, game_ended = game.finish_round_scoring()
                        summary_data = {
                            'type': 'round_summary',
                            'details': details,
                            'game_ended': game_ended,
                            'delay': 5
                        }
                        for ws in game.active_webs.values():
                            try:
                                await ws.send(json.dumps(summary_data))
                            except:
                                pass
                        if game_ended:
                            game.reset_game_scores()
                        game.start_new_round()
                        await broadcast_game_state(room_code)

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if current_room_code and current_room_code in rooms:
            game = rooms[current_room_code]
            game.active_webs.pop(player_sid, None)
            if player_sid in game.players:
                del game.players[player_sid]
            if player_sid in game.player_order:
                game.player_order.remove(player_sid)
            if not game.active_webs:
                rooms.pop(current_room_code, None)

async def main():
    port = int(os.environ.get("PORT", 10000))
    async with websockets.serve(handler, "0.0.0.0", port):
        print(f"[WS] Native WebSocket Server aktif di port {port}")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
