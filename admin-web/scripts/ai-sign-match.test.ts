import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cameraSignMatches } from '../src/ai-sign-match.ts'

test('실제 카메라에서 등록된 전체 이름이 맞아야 한다', () => { assert.equal(cameraSignMatches('제3강의실', '제 3 강의실\n', 'camera'), true) })
test('부분 이름이나 다른 호실은 허용하지 않는다', () => { assert.equal(cameraSignMatches('제3강의실', '제3강의실204', 'camera'), false); assert.equal(cameraSignMatches('제3강의실', '제4강의실', 'camera'), false); assert.equal(cameraSignMatches('ai 듣기', '듣기', 'camera'), false) })
test('예제 사진은 이름이 맞아도 자동 표시에 사용할 수 없다', () => { assert.equal(cameraSignMatches('복도 갈림길', '복도 갈림길', 'sample'), false) })
test('등록된 기준이 없으면 임의의 인식 성공으로 켤 수 없다', () => { assert.equal(cameraSignMatches(undefined, '회의실', 'camera'), false); assert.equal(cameraSignMatches('', '', 'camera'), false) })
test('공백과 기호만 있는 기준은 사용할 수 없다', () => { assert.equal(cameraSignMatches('! !', '! !', 'camera'), false); assert.equal(cameraSignMatches('A', 'A', 'camera'), false) })
