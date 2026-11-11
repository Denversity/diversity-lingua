from app.services.validation import check


def test_placeholders_must_match_exactly():
    assert check("A {{P0}} B", "X {{P0}} Y", machine=True).ok
    assert check("A {{P0}} B", "X Y", machine=True).code == "placeholders"
    assert check("A {{P0}} B", "X {{P0}} {{P0}}", machine=True).code == "placeholders"
    assert check("A {{P0}}", "X {{P1}}", machine=False).code == "placeholders"


def test_machine_cannot_invent_digits_or_markup():
    assert check("Frais {{P0}}", "Frais {{P0}} 2", machine=True).code == "digits"
    assert check("Annuler", "<script>x</script>", machine=True).code == "markup"


def test_empty_echo_and_length():
    assert check("Annuler", "  ", machine=True).code == "empty"
    long = "Votre transaction a été effectuée avec succès"
    assert check(long, long, machine=True).code == "echo"
    assert check("a" * 100, "b", machine=True).code == "length"


def test_human_validated_skips_machine_heuristics_but_not_placeholders():
    assert check("Annuler", "Annuler", machine=False).ok
