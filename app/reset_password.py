"""Set a new generated password for an account and sign it out everywhere."""

import argparse

import app.models  # noqa: F401  (registers tables before creating them)
from app.auth import create_auth_tables, reset_password
from app.database import create_db_and_tables


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    args = parser.parse_args()
    create_db_and_tables()
    create_auth_tables()
    try:
        password = reset_password(args.username)
    except LookupError as error:
        parser.exit(1, f"{error.args[0]}\n")
    print(f"New password for {args.username.strip().lower()}: {password}")


if __name__ == "__main__":
    main()
