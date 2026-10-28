"""The search palette's title scorer (M5 Task 3)."""

from objectapp import fuzzy
from objectapp.fuzzy import ALIAS_PENALTY, EXACT, PREFIX, SUBSTRING, WORD_PREFIX


def test_fuzzy_scale():
    exact = fuzzy.score("analytical engine", "Analytical Engine")
    prefix = fuzzy.score("analyt", "Analytical Engine")
    word_prefix = fuzzy.score("eng anal", "Analytical Engine")
    substring = fuzzy.score("lytical", "Analytical Engine")
    subseq = fuzzy.score("aneg", "Analytical Engine")
    assert exact == (EXACT, [(0, 17)])
    assert prefix == (PREFIX, [(0, 6)])
    assert word_prefix is not None and word_prefix[0] == WORD_PREFIX
    assert word_prefix[1] == [(0, 4), (11, 14)]
    assert substring == (SUBSTRING, [(3, 10)])
    assert subseq is not None and 100 <= subseq[0] <= 300
    assert exact[0] > prefix[0] > word_prefix[0] > substring[0] > subseq[0]
    # Spans index into the text: each span's text spells the query in order.
    text = "Analytical Engine"
    assert "".join(text[a:b] for a, b in subseq[1]).lower() == "aneg"
    # Not a subsequence.
    assert fuzzy.score("xyz", "Analytical Engine") is None
    assert fuzzy.score("", "Analytical Engine") is None
    assert fuzzy.score("   ", "Analytical Engine") is None


def test_fuzzy_contiguity_orders_subsequences():
    tight = fuzzy.score("abcd", "xx abcz d")  # runs: abc, d
    loose = fuzzy.score("abcd", "a x b x c x d")  # four runs
    assert tight is not None and loose is not None
    assert tight[0] > loose[0]
    assert loose[0] == 100


def test_fuzzy_case_and_diacritics():
    hit = fuzzy.score("cafe", "Unicode Café")
    assert hit is not None and hit[0] == WORD_PREFIX
    assert hit[1] == [(8, 12)]
    assert fuzzy.score("CAFÉ", "café") == (EXACT, [(0, 4)])


def test_fuzzy_alias_penalty():
    assert ALIAS_PENALTY == 50
    # The index subtracts the penalty from an alias's score; the scale itself is shared.
    title = fuzzy.score("countess", "Countess of Lovelace")
    assert title == (PREFIX, [(0, 8)])
    assert title[0] - ALIAS_PENALTY < PREFIX
    assert title[0] - ALIAS_PENALTY > WORD_PREFIX
