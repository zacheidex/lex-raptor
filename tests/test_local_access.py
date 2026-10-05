from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from defense import api, auth, budget, db, local_provider
from defense.local_workspace import initialize


@pytest.fixture
def local_mode(tenant, monkeypatch):
    config = replace(auth.settings, auth_mode="local", inference_mode="local")
    monkeypatch.setattr(auth, "settings", config)
    monkeypatch.setattr(api, "settings", config)
    monkeypatch.setattr(
        auth, "get_supabase_user", lambda *_: pytest.fail("Local access contacted Auth")
    )
    initialize(tenant["user"])
    return config


def local_client(**options):
    return TestClient(
        api.app,
        base_url="http://localhost:3000",
        client=options.pop("client", ("127.0.0.1", 50100)),
        headers={"Origin": "http://localhost:3000", **options.pop("headers", {})},
        **options,
    )


def test_account_free_preserves_owner_data_and_ignores_cookies(local_mode, tenant):
    with local_client() as client:
        response = client.get("/api/me")
        assert response.status_code == 200, response.text
        assert response.json()["auth_mode"] == "local"
        assert not client.cookies
        assert client.get("/api/matters/" + tenant["matter"]).status_code == 200
        assert len(client.get("/api/matters").json()) == 1
        # A stale browser cookie cannot select another user's workspace.
        client.cookies.set("defense_access", tenant["other_user"])
        assert client.get("/api/me").json()["email"] == "admin@example.test"
        assert (
            client.post(
                "/api/matters",
                json={"title": "Local test", "represented_party": "Synthetic"},
            ).status_code
            == 200
        )
        assert client.post("/api/auth/login", json={}).status_code == 409
        assert client.post("/api/admin/invitations", json={}).status_code == 409
        assert (
            client.post(
                "/api/matters", headers={"Origin": "https://evil.example"}, json={}
            ).status_code
            == 403
        )
        db.execute(
            "update defense.memberships set active=false where user_id=%s",
            (tenant["user"],),
        )
        assert client.get("/api/me").status_code == 503


@pytest.mark.parametrize(
    "headers",
    [
        {"Host": "evil.example"},
        {"Host": "localhost.evil.example"},
        {"X-Forwarded-Host": "lexraptor.com"},
        {"Origin": "https://evil.example"},
        {"Sec-Fetch-Site": "cross-site"},
    ],
)
def test_local_browser_boundaries(local_mode, headers):
    with local_client(headers=headers) as client:
        assert client.get("/api/me").status_code == 403


def test_remote_client_cannot_bypass_with_forwarded_headers(local_mode):
    with local_client(
        client=("192.0.2.10", 50000), headers={"X-Forwarded-For": "127.0.0.1"}
    ) as client:
        assert client.get("/api/me").status_code == 403


@pytest.mark.parametrize(
    "change", [{"inference_mode": "api"}, {"origin": "https://lexraptor.com"}]
)
def test_local_access_rejects_hosted_or_paid_configuration(
    local_mode, monkeypatch, change
):
    monkeypatch.setattr(auth, "settings", replace(local_mode, **change))
    with local_client() as client:
        assert client.get("/api/me").status_code == 503


def test_local_worker_never_selects_paid_provider(local_mode, monkeypatch):
    monkeypatch.setattr(
        local_provider, "settings", replace(local_mode, inference_mode="api")
    )
    with pytest.raises(budget.GateError, match="account_free_requires_local_inference"):
        local_provider.workspace_provider("unused", "unused")


def test_new_workspace_has_no_auth_account_and_preserves_budget(tenant):
    db.execute("truncate defense.memberships cascade")
    before = db.one("select * from defense.budgets where scope='global'")
    uid = initialize()
    assert initialize() == uid
    assert db.one("select count(*) n from defense.memberships")["n"] == 1
    assert (
        db.one("select email from defense.memberships where user_id=%s", (uid,))[
            "email"
        ]
        == "local@lexraptor.local"
    )
    assert db.one("select * from defense.budgets where scope='global'") == before
    assert not db.one("select enabled from defense.paid_settings")["enabled"]


def test_existing_workspace_requires_explicit_selection(tenant):
    with pytest.raises(RuntimeError, match="Select the local owner"):
        initialize()
