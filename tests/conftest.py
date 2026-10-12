import pytest

from hotel_billing import create_app


@pytest.fixture
def app(tmp_path):
    return create_app({"TESTING": True, "DATABASE": str(tmp_path / "test.sqlite3")})


@pytest.fixture
def client(app):
    return app.test_client()
