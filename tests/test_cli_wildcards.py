"""The journal tools expand wildcards themselves.

`python -m app.outcomes logs/decisions-2026-11-1*.jsonl --blocked` typed in PowerShell failed with "cannot be read (Invalid argument)": a Unix shell expands the star before the program starts, PowerShell and
cmd do not, so the program was handed the star. The tools (outcomes, session_check) now expand a pattern themselves; these tests hand them the pattern exactly as PowerShell does, as a literal string."""

import json
from datetime import date

import pytest
from helpers import FRI, MON, ist
from test_outcomes import rec, write_journal

from app import outcomes, session_check
from app.journal import expand_paths


def touch(folder, *names):
    out = []
    for n in names:
        p = folder / n
        p.write_text("", encoding="utf-8")
        out.append(str(p))
    return out


# -- the expander ----------------------------------------------------------------------------------------------------------------------------------
def test_a_pattern_is_expanded_sorted_and_a_plain_name_is_left_alone(tmp_path):
    a, b, c = touch(tmp_path, "decisions-2026-11-12.jsonl", "decisions-2026-11-10.jsonl", "decisions-2026-11-11.jsonl")
    files, unmatched = expand_paths([str(tmp_path / "decisions-2026-11-1*.jsonl")])
    assert files == [b, c, a] and unmatched == []  # by name, which is by date
    assert expand_paths([a]) == ([a], [])
    assert expand_paths([a, str(tmp_path / "decisions-2026-11-1?.jsonl")]) == ([a, b, c], [])  # a file named twice is named once, in the order it first appeared


def test_a_pattern_that_matches_nothing_is_reported_and_a_plain_name_that_does_not_exist_is_left_for_the_reader_to_say(tmp_path):
    files, unmatched = expand_paths([str(tmp_path / "nothing-*.jsonl"), str(tmp_path / "typo.jsonl")])
    assert files == [str(tmp_path / "typo.jsonl")] and unmatched == [str(tmp_path / "nothing-*.jsonl")]


def test_a_file_that_really_has_a_bracket_or_a_star_in_its_name_is_taken_as_it_is(tmp_path):
    (p,) = touch(tmp_path, "decisions[1].jsonl")
    assert expand_paths([p]) == ([p], [])
    assert expand_paths([]) == ([], [])


def test_character_classes_and_question_marks_work_too(tmp_path):
    a, b, c = touch(tmp_path, "d-0.jsonl", "d-1.jsonl", "d-2.jsonl")
    assert expand_paths([str(tmp_path / "d-[01].jsonl")]) == ([a, b], [])
    assert expand_paths([str(tmp_path / "d-?.jsonl")]) == ([a, b, c], [])


# -- outcomes, given the pattern as PowerShell gives it -------------------------------------------------------------------------------------------
def two_days(tmp_path):
    held = {"id": "trend_pullback:bull:7", "strategy": "trend_pullback", "strategy_name": "Trend Pullback", "direction": "CE", "stage": "BLOCKED", "zone": [25000.0, 25023.0], "trigger": 25000.0,
            "invalidation": 24962.7, "blockers": ["only 18.0 pts to the next level 25,018.00 (under 1x the 37.3 pts at risk)"], "plan": {"targets": [{"n": 1, "price": 25018.0}]}}  # fmt: skip
    write_journal(tmp_path / "decisions-2026-11-06.jsonl", [rec(ist(10, 0, 20, day=FRI), 25010.0, [held])])
    write_journal(tmp_path / "decisions-2026-11-09.jsonl", [rec(ist(10, 0, 20, day=MON), 25010.0, [held])])
    return str(tmp_path / "decisions-2026-11-0*.jsonl")


def test_outcomes_reviews_every_file_a_star_names_and_then_all_of_them_together(tmp_path, capsys, monkeypatch):
    pattern = two_days(tmp_path)
    monkeypatch.setattr(outcomes, "candles_from_db", lambda day, **kw: [(ist(10, 1, day=(day.year, day.month, day.day)), 25010.0, 25019.0, 25005.0, 25015.0)])
    assert outcomes.main([pattern, "--blocked"]) == 0
    out = capsys.readouterr().out
    assert out.count("Outcomes of the setups Prism called ready, 2026-11-") == 2 and "ALL 2 DAYS TOGETHER" in out and "  room: 2 / 2 / 0 / 0 / 0" in out


def test_outcomes_says_so_when_a_pattern_matches_nothing_and_exits_two(tmp_path, capsys):
    assert outcomes.main([str(tmp_path / "decisions-2030-*.jsonl"), "--blocked"]) == 2
    assert "decisions-2030-*.jsonl: no journal matches" in capsys.readouterr().err


def test_candles_from_a_file_still_belong_to_one_journal_after_the_star_is_expanded(tmp_path, capsys):
    pattern = two_days(tmp_path)
    c = tmp_path / "day.json"
    c.write_text(json.dumps([]), encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        outcomes.main([pattern, "--candles", str(c)])  # the star names two journals
    assert e.value.code == 2 and "one journal" in capsys.readouterr().err
    assert outcomes.main([str(tmp_path / "decisions-2026-11-06.jsonl"), "--candles", str(c)]) == 0  # one journal, by its plain name, is fine


def test_outcomes_with_a_star_that_names_one_file_works_like_naming_it(tmp_path, capsys, monkeypatch):
    two_days(tmp_path)
    monkeypatch.setattr(outcomes, "candles_from_db", lambda day, **kw: [])
    assert outcomes.main([str(tmp_path / "decisions-2026-11-06.jso*")]) == 0
    out = capsys.readouterr().out
    assert "ALL " not in out and out.count("Outcomes of the setups Prism called ready") == 1


# -- session_check ---------------------------------------------------------------------------------------------------------------------------------
def test_session_check_takes_a_star_too_and_says_so_when_it_matches_nothing(tmp_path, capsys):
    two_days(tmp_path)
    assert session_check.main([str(tmp_path / "decisions-2026-11-0*.jsonl"), "--coverage"]) in (0, 1)
    out = capsys.readouterr().out
    assert "2026-11-06" in out and "2026-11-09" in out
    assert session_check.main([str(tmp_path / "nope-*.jsonl")]) == 2
    assert "nope-*.jsonl: no journal matches" in capsys.readouterr().err
    assert date(2026, 11, 6)  # (a plain name that does not exist is still said by the reader, as before)
    assert session_check.main([str(tmp_path / "typo.jsonl")]) == 2 and "cannot be read" in capsys.readouterr().err
