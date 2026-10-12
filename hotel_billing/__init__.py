import os

from flask import Flask

from . import db
from .billing import fmt


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev"),
        DATABASE=os.path.join(app.instance_path, "hotel_billing.sqlite3"),
    )
    if test_config:
        app.config.update(test_config)
    os.makedirs(app.instance_path, exist_ok=True)

    app.teardown_appcontext(db.close_db)
    app.jinja_env.filters["money"] = fmt

    with app.app_context():
        db.init_db()

    from .views import bp
    app.register_blueprint(bp)
    return app
