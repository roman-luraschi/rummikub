from rummikub.game.tile import Color, Tile, build_deck, parse_tiles


def test_deck_has_106_unique_tiles():
    deck = build_deck()
    assert len(deck) == 106
    assert len({t.id for t in deck}) == 106
    assert sum(t.is_joker for t in deck) == 2


def test_numbered_encoding_roundtrip():
    tile = Tile.numbered(Color.RED, 12, copy=1)
    assert tile.color is Color.RED
    assert tile.rank == 12
    assert tile.copy == 1
    assert not tile.is_joker
    assert str(tile) == "12R"


def test_parse_tiles_assigns_copies():
    tiles = parse_tiles("7R 7R 7B")
    assert tiles[0].copy == 0
    assert tiles[1].copy == 1
    assert tiles[0].id != tiles[1].id
    assert tiles[2].color is Color.BLUE


def test_joker_rack_value():
    assert Tile.joker(0).rack_value() == 30
    assert Tile.numbered(Color.ORANGE, 13).rack_value() == 13
