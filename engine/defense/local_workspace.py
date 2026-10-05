"""Owner-run initialization for a single local workspace, without an account."""

from uuid import uuid4

from . import db


def initialize(existing_user_id=None):
    with db.connect() as c:
        # Serialize initial setup; browser requests never create identities.
        c.execute("lock table defense.local_workspace in exclusive mode")
        saved = c.execute("select user_id from defense.local_workspace").fetchone()
        if saved:
            return str(saved["user_id"])
        if existing_user_id:
            member = c.execute(
                "select user_id,org_id from defense.memberships where user_id=%s and active and role='admin'",
                (existing_user_id,),
            ).fetchone()
            if not member:
                raise RuntimeError(
                    "The selected local owner is not an active administrator"
                )
            uid, org = member["user_id"], member["org_id"]
        else:
            if c.execute("select 1 from defense.memberships limit 1").fetchone():
                raise RuntimeError(
                    "Existing workspaces found. Select the local owner with --existing-user-id."
                )
            uid = uuid4()
            org = c.execute(
                "insert into defense.organizations(name) values('Lex Raptor local workspace') returning id"
            ).fetchone()["id"]
            c.execute(
                "insert into defense.memberships(user_id,org_id,email,role) values(%s,%s,'local@lexraptor.local','admin')",
                (uid, org),
            )
        c.execute("insert into defense.local_workspace(user_id) values(%s)", (uid,))
        for scope in ["global", f"org:{org}", f"user:{uid}"]:
            c.execute(
                "insert into defense.budgets(scope,cap_micro) values(%s,0) on conflict do nothing",
                (scope,),
            )
        # Existing balances and reservations are preserved. No paid calls here.
        c.execute("update defense.paid_settings set enabled=false where id=true")
    return str(uid)
