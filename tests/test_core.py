"""Core tests for Wallet Scout. Standard library only, no network.

Run from the project folder:  python -m unittest discover -s tests -v
"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = tempfile.TemporaryDirectory()
os.environ["WALLET_SCOUT_DATA"] = str(Path(TMP.name) / "data")
os.environ["WALLET_SCOUT_CONFIG"] = str(Path(TMP.name) / "config.json")
# Partial override: only S and the strong-signal USD change, every other key keeps its default.
Path(os.environ["WALLET_SCOUT_CONFIG"]).write_text(json.dumps({"GRADE_FLOORS": {"S": 90}, "SIGNAL": {"strongUsd": 1500}}), encoding="utf-8")
sys.path.insert(0, str(ROOT))

import oss_config  # noqa: E402
import smart_money as sm  # noqa: E402


def addr(n: int) -> str:
    return "0x" + format(n, "040x")


def stats(**pnl):
    base = {"realized_profit": 0, "realized_profit_pnl": 0, "buy": 0, "sell": 0, "bought_cost": 0, "last_timestamp": int(time.time()),
            "pnl_stat": {"token_num": 0, "winrate": 0, "pnl_2x_5x_num": 0, "pnl_gt_5x_num": 0, "pnl_lt_nd5_num": 0, "avg_holding_period": 0},
            "common": {"created_token_count": 0}}
    for k, v in pnl.items():
        if k in base["pnl_stat"]:
            base["pnl_stat"][k] = v
        elif k in base["common"]:
            base["common"][k] = v
        else:
            base[k] = v
    return base


class ConfigTest(unittest.TestCase):
    def test_partial_override_keeps_other_keys(self):
        self.assertEqual(sm.GRADE_FLOORS["S"], 90)
        self.assertIn("A", sm.GRADE_FLOORS)
        self.assertEqual(sm.SIGNAL["strongUsd"], 1500)
        self.assertIn("mediumUsd", sm.SIGNAL)

    def test_cfg_types(self):
        self.assertEqual(oss_config.cfg("NOT_SET", (1, 2)), (1, 2))
        self.assertEqual(oss_config.cfg("NOT_SET", {"a": 1}), {"a": 1})

    def test_example_config_matches_defaults(self):
        example = json.loads((ROOT / "config.example.json").read_text(encoding="utf-8"))
        for key in ("SCORE_WEIGHTS", "SCORE_SCALE", "SCORE_PENALTY", "GRADE_FLOORS", "GRADE_WEIGHT", "SIGNAL"):
            self.assertIn(key, example)
            self.assertIn(key, example["_help"])
        self.assertAlmostEqual(sum(example["SCORE_WEIGHTS"].values()), 1.0)


class ScoreTest(unittest.TestCase):
    def test_grades_follow_floors(self):
        self.assertEqual(sm.grade_of(95), "S")
        self.assertEqual(sm.grade_of(85), "A")
        self.assertEqual(sm.grade_of(sm.GRADE_FLOORS["B"]), "B")
        self.assertEqual(sm.grade_of(0), "D")

    def test_strong_wallet_scores_high(self):
        s = sm.SCORE_SCALE
        out = sm.compute_score(stats(realized_profit=s["profitFullUsd"], realized_profit_pnl=s["roiFull"], buy=200, sell=150,
                                     bought_cost=200 * 500, token_num=s["sampleFull"], winrate=s["winFull"],
                                     pnl_2x_5x_num=s["sampleFull"]))
        self.assertGreaterEqual(out["score"], 95)
        self.assertEqual(out["stats"]["penalties"], [])

    def test_empty_wallet_scores_low(self):
        out = sm.compute_score(stats())
        self.assertLessEqual(out["score"], 5)
        self.assertEqual(out["grade"], "D")
        self.assertIn("thin", out["stats"]["penalties"])

    def test_penalties(self):
        out = sm.compute_score(stats(realized_profit=5000, realized_profit_pnl=0.3, buy=40, sell=40, bought_cost=40 * 5,
                                     token_num=10, winrate=0.5, created_token_count=8))
        self.assertIn("dev", out["stats"]["penalties"])
        self.assertIn("dust", out["stats"]["penalties"])
        self.assertIn("发币方", out["style"])

    def test_rule_texts_use_config(self):
        texts = " ".join(r["rule"] for r in sm.SCORE_RULES)
        self.assertIn(f"{sm.SCORE_SCALE['sampleFull']} 颗满分", texts)
        self.assertIn(f"S {sm.GRADE_FLOORS['S']} 分以上", sm.GRADE_TEXT)


class SignalTest(unittest.TestCase):
    token = addr(0xA1)

    def setUp(self):
        def reset(conn):
            for table in ("sm_trades", "sm_wallets", "sm_tokens"):
                conn.execute(f"DELETE FROM {table}")
            conn.execute("INSERT INTO sm_tokens (chain, ca, symbol, launchpad, supply, mcap) VALUES ('bsc', ?, 'TEST', 'fourmeme', 1e9, 50000)",
                         (self.token,))
        sm.db(reset)

    def add(self, n: int, grade: str, buy: float, sell: float = 0.0):
        now = int(time.time())

        def work(conn):
            a = addr(n)
            conn.execute("INSERT INTO sm_wallets (chain, address, grade, score, watch) VALUES ('bsc', ?, ?, 70, 1)", (a, grade))
            conn.execute("INSERT INTO sm_trades (chain, tx, maker, token, side, symbol, usd, amount, price, ts, source) "
                         "VALUES ('bsc', ?, ?, ?, 'buy', 'TEST', ?, 1, 0.00005, ?, 'test')", (f"b{n}", a, self.token, buy, now - 600))
            if sell:
                conn.execute("INSERT INTO sm_trades (chain, tx, maker, token, side, symbol, usd, amount, price, ts, source) "
                             "VALUES ('bsc', ?, ?, ?, 'sell', 'TEST', ?, 1, 0.00005, ?, 'test')", (f"s{n}", a, self.token, sell, now - 300))
        sm.db(work)

    def strength(self):
        out = sm.overview({"chain": "bsc", "window": 3600, "minUsd": 50}, None)
        found = [s for s in out["signals"] if s["ca"] == self.token]
        return found[0]["strength"] if found else None

    def test_strong(self):
        per = sm.SIGNAL["strongUsd"] / sm.SIGNAL["strongWallets"] + 1
        for i in range(sm.SIGNAL["strongWallets"]):
            self.add(i + 1, "A", per)
        self.assertEqual(self.strength(), "strong")

    def test_medium(self):
        per = sm.SIGNAL["mediumUsd"] / sm.SIGNAL["mediumWallets"] + 1
        for i in range(sm.SIGNAL["mediumWallets"]):
            self.add(i + 1, "B", per)
        self.assertEqual(self.strength(), "medium")

    def test_exited_wallets_do_not_count(self):
        per = sm.SIGNAL["mediumUsd"]
        self.add(1, "A", per)
        self.add(2, "A", per, sell=per)
        self.assertNotEqual(self.strength(), "medium")

    def test_low_weight_wallets_do_not_count(self):
        for i in range(4):
            self.add(i + 1, "D", 1000)
        self.assertIsNone(self.strength())


if __name__ == "__main__":
    unittest.main()
