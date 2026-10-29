"""Exercise an app in a disposable copy of its folder, with bounded output."""
import json
import sys
from streamlit.testing.v1 import AppTest

source, checks_file = sys.argv[1:3]
with open(checks_file, encoding="utf-8") as handle:
    checks = json.load(handle)


def summary(app):
    parts = []
    for kind in ('title', 'header', 'subheader', 'markdown', 'caption', 'text', 'metric', 'dataframe', 'table', 'success', 'info', 'warning', 'error'):
        for element in app.get(kind):
            value = getattr(element, 'value', '')
            parts.append(str(value)[:2000])
    return '\n'.join(parts)[:12000]


try:
    app = AppTest.from_file(source, default_timeout=15).run()
    if app.exception:
        raise ValueError(str(app.exception[0].message))
    widgets = [(kind, item.label) for kind in ('checkbox', 'toggle', 'selectbox', 'radio', 'slider', 'number_input', 'text_input', 'button', 'multiselect', 'text_area', 'date_input', 'file_uploader', 'chat_input') for item in app.get(kind)]
    if widgets and not checks:
        raise ValueError('Provide a check for the main interaction. Widgets: ' + str(widgets)[:2000])
    reports = []
    for check in checks:
        before = summary(app)
        candidates = [item for item in app.get(check['widget']) if item.label == check['label']]
        if len(candidates) != 1:
            raise ValueError('Expected one widget labelled ' + check['label'])
        widget = candidates[0]
        if check['widget'] == 'button':
            widget.click().run()
        else:
            if 'value' not in check:
                raise ValueError('A value is required for ' + check['label'])
            value = check['value']
            if check['widget'] == 'date_input':
                import datetime
                value = datetime.date.fromisoformat(value)
            widget.set_value(value).run()
        if app.exception:
            raise ValueError(str(app.exception[0].message))
        visible = summary(app)
        if visible == before:
            raise ValueError('The interaction did not change visible output. Check a meaningful result, using a value that differs from the default, for ' + check['label'])
        if check['expectText'] not in visible:
            raise ValueError('After ' + check['label'] + ', expected ' + repr(check['expectText']) + '. Actual output: ' + visible[:2500])
        reports.append('Passed: ' + check['label'] + ' -> ' + check['expectText'])
    print(json.dumps({'ok': True, 'text': '\n'.join(reports) if reports else 'Static report rendered without exceptions.'}))
except Exception as error:
    print(json.dumps({'ok': False, 'text': str(error)[:4000]}))
