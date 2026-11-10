"""Rude and sexual words are kept out of names others see (ADR 0011), however they are spelled;
ordinary names, which may contain the same letters, are not."""

import pytest
from fastapi.testclient import TestClient

from app.services.decency import is_rude


@pytest.mark.parametrize(
    "name",
    [
        "sex",
        "SEX",
        "s e x",
        "s.e.x",
        "s3x",
        "Sexy Anna",
        "секс",
        "сeкс",  # Latin «е»
        "fuck",
        "fuuuck",
        "f u c k",
        "Retard",
        "retarded",
        "Bitch",
        "whore",
        "хуй",
        "ХУЙ",
        "xуй",
        "x y й",
        "пизда",
        "бля́дь".replace("́", ""),
        "ебать",
        "пидор",
        "pidor",
        "сука",
        "Сука Аня",
        "Дебил",
        "идиот",
        "мудак",
        "шлюха",
        "сиськи",
        "dildo",
        "porn star",
        "порно",
        "ass",
        "Жалап",
        "қотақ",
        "Котак",
        "amjalab",
        "сигейин",
    ],
)
def test_rude_names_are_caught(name: str) -> None:
    assert is_rude(name)


@pytest.mark.parametrize(
    "name",
    [
        "Анна К.",
        "Нурлан",
        "Асель",
        "Assel",
        "Essex",
        "Alexander",
        "Алексей",
        "Шебалин",
        "Nigora",
        "Nigar",
        "Ishita",
        "Nguyen Huy",
        "Dick",
        "Sukhrob",
        "Асука",
        "Analia",
        "Тимур",
        "Даурен",
        "Уродов?".rstrip("?"),
        "Сукачёв",
        "член группы",
        "7Б английский",
        "Друзья",
        "Себастьян",
        "педикюр",
        "Котакбай",
        "O‘g‘il",
        "Айпери",
        "Бегимай",
    ],
)
def test_ordinary_names_pass(name: str) -> None:
    assert not is_rude(name)


def test_people_and_groups_cannot_be_named_rudely(client: TestClient) -> None:
    headers = {"X-Dev-User": "pavel"}
    response = client.patch("/api/me", json={"name": "S3x"}, headers=headers)
    assert (response.status_code, response.json()["error"]["code"]) == (422, "name_not_allowed")
    assert client.patch("/api/me", json={"name": "Павел"}, headers=headers).status_code == 200
    group = client.post("/api/groups", json={"name": "f.u.c.k"}, headers=headers)
    assert (group.status_code, group.json()["error"]["code"]) == (422, "name_not_allowed")
    made = client.post("/api/groups", json={"name": "Друзья"}, headers=headers).json()
    renamed = client.patch(f"/api/groups/{made['id']}", json={"name": "Дебил"}, headers=headers)
    assert renamed.json()["error"]["code"] == "name_not_allowed"
