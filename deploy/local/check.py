#!/usr/bin/env python3
"""Exercise the real local server, then reuse fixtures to verify persistence."""
import datetime
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
BASE = 'http://localhost:3000'
STATE = HERE / '.state'


class Client:
    def __init__(self):
        self.headers = {}

    def request(self, path, body=None, raw=False, content_type=None):
        headers = dict(self.headers)
        if body is not None:
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
                content_type = 'application/json'
            headers['Content-Type'] = content_type
        request = urllib.request.Request(BASE + path, data=body, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
        except urllib.error.HTTPError as error:
            detail = json.loads(error.read()).get('error', str(error.code))
            raise RuntimeError(f'{request.method} {path}: {detail}') from None
        if raw:
            return data
        result = json.loads(data)
        if result.get('success') is False or result.get('status') == 'error':
            raise RuntimeError(f'{path}: {result.get("error", "request failed")}')
        return result

    def api(self, path, body=None):
        return self.request('/api/v1/' + path, body)

    def login(self, username, password):
        data = self.api('login', {'user': username, 'password': password})['data']
        self.headers = {'X-User-Id': data['userId'], 'X-Auth-Token': data['authToken']}
        return self


def save(path, value):
    temporary = path.with_suffix('.tmp')
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
        json.dump(value, f, indent=2)
        f.write('\n')
    temporary.replace(path)


def create_fixture(admin):
    suffix = secrets.token_hex(4)
    users = []
    for label in ['alice', 'bob']:
        user = {'username': f'local_{label}_{suffix}', 'password': secrets.token_urlsafe(24)}
        created = admin.api('users.create', {
            **user, 'email': user['username'] + '@rocketchat.test',
            'name': 'Local Test ' + label.title(), 'verified': True,
            'active': True, 'roles': ['user'], 'sendWelcomeEmail': False,
            'requirePasswordChange': False,
        })['user']
        user['id'] = created['_id']
        users.append(user)
    room_name = 'local-check-' + suffix
    room = admin.api('channels.create', {'name': room_name, 'members': [u['username'] for u in users]})['channel']
    alice = Client().login(users[0]['username'], users[0]['password'])
    channel_message = alice.api('chat.postMessage', {
        'roomId': room['_id'], 'text': 'Persistent channel message ' + suffix,
    })['message']
    dm = alice.api('im.create', {'username': users[1]['username']})['room']
    dm_message = alice.api('chat.postMessage', {
        'roomId': dm['_id'], 'text': 'Persistent direct message ' + suffix,
    })['message']
    payload = 'Rocket.Chat local Docker upload verification ' + suffix + '\n'
    boundary = 'RocketChatLocal' + suffix
    multipart = (
        '--' + boundary + '\r\n'
        'Content-Disposition: form-data; name="file"; filename="verification.txt"\r\n'
        'Content-Type: text/plain\r\n\r\n' + payload + '\r\n--' + boundary + '--\r\n'
    ).encode()
    uploaded = alice.request('/api/v1/rooms.media/' + room['_id'], multipart,
                             content_type='multipart/form-data; boundary=' + boundary)['file']
    alice.api(f'rooms.mediaConfirm/{room["_id"]}/{uploaded["_id"]}', {
        'msg': 'Persistent attachment ' + suffix, 'description': 'Local installation verification',
    })
    return {
        'users': users, 'channel_name': room_name, 'channel_id': room['_id'],
        'channel_message_id': channel_message['_id'], 'dm_id': dm['_id'],
        'dm_message_id': dm_message['_id'], 'upload_url': uploaded['url'],
        'upload_content': payload,
    }


def main():
    STATE.mkdir(mode=0o700, exist_ok=True)
    os.chmod(STATE, 0o700)
    env = dict(line.split('=', 1) for line in (HERE / '.env').read_text().splitlines()
               if line and not line.startswith('#'))
    Client().request('/api/info')
    admin = Client().login(env['ADMIN_USERNAME'], env['ADMIN_PASS'])
    # The anonymous endpoint intentionally omits the patch version.
    info = admin.request('/api/info')
    version = info.get('version') or info.get('info', {}).get('version')
    if version != '8.9.0':
        raise RuntimeError('Unexpected Rocket.Chat version: ' + str(version))
    print('PASS: Rocket.Chat 8.9.0 HTTP health', flush=True)
    if 'admin' not in admin.api('me')['roles']:
        raise RuntimeError('Initial user is not an administrator')
    print('PASS: administrator login and role', flush=True)
    fixture_path = STATE / 'fixture.json'
    if fixture_path.exists():
        fixture = json.loads(fixture_path.read_text())
    else:
        fixture = create_fixture(admin)
        save(fixture_path, fixture)
    bob = Client().login(fixture['users'][1]['username'], fixture['users'][1]['password'])
    for kind, room, message in [('channels', fixture['channel_id'], fixture['channel_message_id']),
                                ('im', fixture['dm_id'], fixture['dm_message_id'])]:
        result = bob.api('chat.getMessage?' + urllib.parse.urlencode({'msgId': message}))
        if result['message']['_id'] != message or result['message']['rid'] != room:
            raise RuntimeError(kind + ' message not preserved or not visible to recipient')
        print('PASS: recipient reads persistent ' + kind + ' message', flush=True)
    # File routes accept Meteor login cookies, independently of the REST API headers.
    bob.headers['Cookie'] = 'rc_uid=' + bob.headers['X-User-Id'] + '; rc_token=' + bob.headers['X-Auth-Token']
    uploaded = bob.request(fixture['upload_url'], raw=True).decode()
    if uploaded != fixture['upload_content']:
        raise RuntimeError('Downloaded attachment differs from uploaded bytes')
    print('PASS: recipient downloads persistent attachment with identical content', flush=True)
    save(STATE / 'api-report.json', {
        'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'version': version, 'administrator': 'pass', 'channel': 'pass', 'direct_message': 'pass',
        'attachment': 'pass', 'channel_name': fixture['channel_name'],
    })


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FAIL: ' + str(error), file=sys.stderr)
        sys.exit(1)
