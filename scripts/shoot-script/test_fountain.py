#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unit tests for the Fountain subset and the lint rules.  python test_fountain.py"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import fountain      # noqa: E402
import lint as lintmod  # noqa: E402
import render        # noqa: E402

SAMPLE = u"""Title: EP99 - THE TEST
Shoot: SHOOT SCRIPT - 2 setups

EXT. DRY SLOPE, IN THE SUN - DAY

Jason walks the slope. He finds a rock and turns it over.

!ON CAMERA: the hand picking the rock up off the ground.

JASON
(first words, exactly)
Same rock. Different hand.
(then, in his own words)
Who Telford was, and why he wanted a road that does not sink.

[[This is P1; it welds to the Jul 31 tape.]]

/* an old take that is gone
   for good */

.THE TANK PAD, LOOKING DOWNHILL

= Cari and Jason on the pad, working out how the tarp goes on.

Jason kneels and sets the rock down.

INTERVIEWER
What were you thinking when you set that first stone?

JASON
(in his own words)
That it was going to work.
"""


class TestParser(unittest.TestCase):
    def setUp(self):
        self.s = fountain.parse(SAMPLE)

    def test_title_page(self):
        self.assertEqual(self.s.title['title'], 'EP99 - THE TEST')
        self.assertEqual(self.s.title['shoot'], 'SHOOT SCRIPT - 2 setups')

    def test_scene_headings_numbered_in_order(self):
        scenes = self.s.scenes()
        self.assertEqual([n for n, _h, _e in scenes], [1, 2])
        self.assertEqual(scenes[0][1].text, 'EXT. DRY SLOPE, IN THE SUN - DAY')
        # forced with a leading dot, and the dot is not printed
        self.assertEqual(scenes[1][1].text, 'THE TANK PAD, LOOKING DOWNHILL')

    def test_nothing_before_scene_one(self):
        self.assertEqual(self.s.preamble(), [])

    def test_forced_action_and_on_camera(self):
        oc = [e for e in self.s.elements if e.is_on_camera]
        self.assertEqual(len(oc), 1)
        self.assertEqual(oc[0].on_camera_text, 'the hand picking the rock up off the ground.')

    def test_action_is_action(self):
        acts = [e for e in self.s.elements if e.type == 'action' and not e.is_on_camera]
        self.assertTrue(any(a.text.startswith('Jason walks the slope') for a in acts))

    def test_character_parenthetical_dialogue(self):
        types = [e.type for e in self.s.elements if e.scene == 1 and
                 e.type in ('character', 'parenthetical', 'dialogue')]
        self.assertEqual(types, ['character', 'parenthetical', 'dialogue',
                                 'parenthetical', 'dialogue'])

    def test_delivery_conventions(self):
        parens = [e for e in self.s.elements if e.type == 'parenthetical']
        self.assertEqual(parens[0].delivery, 'exact')
        self.assertEqual(parens[1].delivery, 'briefing')

    def test_notes_are_captured_and_stripped(self):
        notes = [n for _l, n in self.s.all_notes()]
        self.assertEqual(len(notes), 1)
        self.assertIn('welds', notes[0])
        for el in self.s.elements:
            self.assertNotIn('[[', el.text)
            self.assertNotIn('P1;', el.text)

    def test_note_only_element_prints_nothing(self):
        self.assertTrue(any(e.type == 'note_only' for e in self.s.elements))

    def test_boneyard_is_gone(self):
        blob = ' '.join(e.text for e in self.s.elements)
        self.assertNotIn('an old take', blob)
        self.assertNotIn('/*', blob)

    def test_synopsis(self):
        syn = [e for e in self.s.elements if e.type == 'synopsis']
        self.assertEqual(len(syn), 1)
        self.assertTrue(syn[0].text.startswith('Cari and Jason on the pad'))
        self.assertEqual(syn[0].scene, 2)

    def test_line_numbers_survive_multiline_notes(self):
        # the second scene heading is on the line the source says it is
        want = SAMPLE.split('\n').index('.THE TANK PAD, LOOKING DOWNHILL') + 1
        head = self.s.scenes()[1][1]
        self.assertEqual(head.line, want)

    def test_characters_and_blocks(self):
        self.assertEqual(self.s.characters(), ['JASON', 'INTERVIEWER'])
        blocks = self.s.blocks()
        self.assertEqual(len(blocks), 3)
        self.assertEqual(blocks[1]['character'], 'INTERVIEWER')
        self.assertEqual(blocks[1]['scene'], 2)

    def test_character_name_strips_extension(self):
        self.assertEqual(fountain.character_name("JASON (V.O.)"), 'JASON')
        self.assertEqual(fountain.character_name("CARI ^"), 'CARI')

    def test_caps_action_needs_a_bang(self):
        s = fountain.parse(u"EXT. HILL - DAY\n\n!A WIDE SHOT OF THE HILL\n\nsomething\n")
        self.assertEqual([e.type for e in s.elements], ['scene_heading', 'action', 'action'])

    def test_emphasis_strip_and_render(self):
        self.assertEqual(fountain.strip_emphasis('a **bold** and *thin* _line_'),
                         'a bold and thin line')
        self.assertIn('<b>bold</b>', render.rich('**bold**'))


class TestSides(unittest.TestCase):
    def setUp(self):
        self.s = fountain.parse(SAMPLE)

    def test_jason_sides_have_both_kinds(self):
        md = render.sides_md(self.s, 'JASON')
        self.assertIn('**Same rock. Different hand.**', md)      # exact
        self.assertIn('> Who Telford was', md)                   # briefing
        self.assertNotIn('What were you thinking', md)           # not his line

    def test_question_cards(self):
        html = render.question_card_html(self.s, 'INTERVIEWER')
        self.assertIn('What were you thinking', html)
        self.assertIsNone(render.question_card_html(self.s, 'NOBODY'))

    def test_cari_copy_has_no_notes(self):
        html = render.script_html(self.s, show_notes=False)
        self.assertNotIn('welds', html)
        self.assertIn('MUST BE ON CAMERA', html)
        editors = render.script_html(self.s, show_notes=True)
        self.assertIn('welds', editors)


BAD = u"""Title: THE BAD ONE

This is a preamble paragraph that she should never see.

EXT. THE PAD - DAY

Jason sets the rock. The in and the out of this act live here, and the weld is
the line about the hammer. See page five for the rest. Clip 0067_D and C012
cover it, and it attaches to serving two on the spine at beat 4.

JASON
He said "the ideal way is expensive" back when we were pouring.

EXT. THE SLOPE - DAY

Jason walks up the hill. As described in scene 9, this is the sitting.
"""


class TestLint(unittest.TestCase):
    def setUp(self):
        self.f = lintmod.lint(fountain.parse(BAD))
        self.rules = set(f.rule.split(':')[0] for f in self.f)
        self.ids = set(f.rule for f in self.f)

    def _level(self, prefix):
        return [f.level for f in self.f if f.rule.startswith(prefix)]

    def test_preamble_is_an_error(self):
        self.assertIn('ERROR', self._level('preamble'))

    def test_every_jargon_class_fires(self):
        for want in ('jargon:in-out', 'jargon:weld', 'jargon:attach', 'jargon:serving',
                     'jargon:spine', 'jargon:beat-id', 'jargon:clip-id-a', 'jargon:clip-id-b'):
            self.assertIn(want, self.ids, want)
            self.assertEqual(self._level(want), ['ERROR'] * self._level(want).count('ERROR'))

    def test_forward_reference_errors(self):
        self.assertIn('forward-ref:see-page', self.ids)
        self.assertIn('forward-ref:as-described', self.ids)

    def test_backward_scene_reference_is_allowed(self):
        ok = fountain.parse(u"EXT. A - DAY\n\nx\n\nEXT. B - DAY\n\nAs described in scene 1, "
                            u"he sets it down.\n")
        rules = [f.rule for f in lintmod.lint(ok)]
        self.assertFalse([r for r in rules if r.startswith('forward-ref')])

    def test_quote_without_synopsis_warns(self):
        self.assertIn('quote-no-synopsis', self.ids)
        hits = [f for f in self.f if f.rule == 'quote-no-synopsis']
        self.assertEqual(hits[0].level, 'WARN')

    def test_quote_with_synopsis_is_quiet(self):
        good = fountain.parse(u"EXT. A - DAY\n\n= Cari and Jason on the pad, working out the "
                              u"tarp.\n\nJASON\nRemember when you said \"it has to drain\"?\n")
        self.assertFalse([f for f in lintmod.lint(good) if f.rule == 'quote-no-synopsis'])

    def test_house_jargon_warns(self):
        self.assertIn('house-jargon:the-sitting', self.ids)
        self.assertEqual([f.level for f in self.f if f.rule == 'house-jargon:the-sitting'],
                         ['WARN'])

    def test_missing_on_camera_warns(self):
        self.assertIn('no-on-camera', self.ids)

    def test_notes_are_exempt(self):
        s = fountain.parse(u"EXT. A - DAY\n\n!ON CAMERA: his hands.\n\n"
                           u"[[weld to 0067_D, serving two, THEREFORE joint, beat 4]]\n")
        self.assertEqual([f for f in lintmod.lint(s) if f.level == 'ERROR'], [])

    def test_exit_code_contract(self):
        self.assertTrue(any(f.level == 'ERROR' for f in self.f))
        txt = lintmod.report(self.f, 'BAD')
        self.assertIn('ERRORS MUST BE FIXED', txt)


class TestVoice(unittest.TestCase):
    """Cari + Jason, Sep 19 2026: his lines in the first person, her questions to him."""

    def _rules(self, text):
        return set(f.rule for f in lintmod.lint(fountain.parse(text)))

    def test_third_person_self_reference_errors(self):
        r = self._rules(u"EXT. THE HILL - DAY\n\n!ON CAMERA: the stone.\n\nJASON\n"
                        u"(in his own words)\nThe crusher is what he cannot afford. "
                        u"The rock and the hands he already has.\n")
        self.assertIn('voice:third-person', r)

    def test_first_person_is_clean(self):
        r = self._rules(u"EXT. THE HILL - DAY\n\n!ON CAMERA: the stone.\n\nJASON\n"
                        u"(in his own words)\nI can't afford the crusher. The rock and the "
                        u"hands, I already have.\n")
        self.assertNotIn('voice:third-person', r)

    def test_he_is_allowed_when_somebody_else_is_named(self):
        r = self._rules(u"EXT. THE HILL - DAY\n\n!ON CAMERA: the stone.\n\nJASON\n"
                        u"(in his own words)\nThomas Telford was a shepherd's son, and he "
                        u"wanted a road that does not sink.\n")
        self.assertNotIn('voice:third-person', r)

    def test_speaker_naming_himself_errors(self):
        r = self._rules(u"EXT. THE HILL - DAY\n\n!ON CAMERA: the stone.\n\nJASON\n"
                        u"Jason explains why the pad has to be level.\n")
        self.assertIn('voice:own-name', r)

    def test_interviewer_topic_instead_of_question_errors(self):
        r = self._rules(u"EXT. THE PAD - DAY\n\n!ON CAMERA: the tank.\n\nINTERVIEWER\n"
                        u"His thoughts on the tarp and where it went.\n")
        self.assertIn('voice:not-to-him', r)

    def test_interviewer_second_person_without_a_question_errors(self):
        r = self._rules(u"EXT. THE PAD - DAY\n\n!ON CAMERA: the tank.\n\nINTERVIEWER\n"
                        u"Your reasons for putting the tank up the hill.\n")
        self.assertIn('voice:not-a-question', r)

    def test_a_real_question_is_clean(self):
        r = self._rules(u"EXT. THE PAD - DAY\n\n!ON CAMERA: the tank.\n\nINTERVIEWER\n"
                        u"Why did you put the tank up the hill instead of by the house?\n")
        self.assertFalse([x for x in r if x.startswith('voice:')])

    def test_imperative_question_is_clean(self):
        r = self._rules(u"EXT. THE PAD - DAY\n\n!ON CAMERA: the tank.\n\nINTERVIEWER\n"
                        u"Tell me where you were coming from on that.\n")
        self.assertFalse([x for x in r if x.startswith('voice:')])

    def test_action_stays_third_person(self):
        r = self._rules(u"EXT. THE PAD - DAY\n\nJason kneels and sets his rock down on "
                        u"the ground.\n\n!ON CAMERA: his hands.\n")
        self.assertFalse([x for x in r if x.startswith('voice:')])


class TestTitleKeysForTheLibrary(unittest.TestCase):
    def test_house_keys_parse(self):
        s = fountain.parse(u"Title: EP6 - A\nEpisode: EP6\nShoot-Type: A\n"
                           u"Shoot-Date: 2026-09-19\n\nEXT. HILL - DAY\n\nx\n")
        self.assertEqual(s.title['episode'], 'EP6')
        self.assertEqual(s.title['shoot-type'], 'A')
        self.assertEqual(s.title['shoot-date'], '2026-09-19')


if __name__ == '__main__':
    unittest.main(verbosity=2)
