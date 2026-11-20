"""Analytic regression cases for the supplied quadratic-programming model."""

import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("planning_engine", ROOT / "src/engine/model.py")
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)


def configuration():
    return {
        "kind": "quadratic",
        "quadratic": {
            "A": [[-.5, 0], [0, -.3]], "b0": [3, 2], "b1": [1, .8],
            "c0": 0, "c1": 0,
            "K": [[.2, .1], [.1, .2], [1, 0], [0, 1], [.05, .05]],
            "l0": [20, 15, 50, 50, 30], "l1": [.5, .3, -1, 1, .2],
        },
        "production": {
            "M": [[.7, 0], [0, .5]], "H": [[.1, 0, 0], [0, .1, 0], [0, 0, .1]],
            "R": [[.15, .03], [.05, .3], [.1, .06]], "resourceLimits": [18, 11, 1],
            "capacity0": [8, 23], "capacity1": [0, 0], "k": [3, 4],
            "p0": [20, 30], "p1": [2, -.1], "r0": [3, 2, 6], "r1": [2, .3, -.3],
            "v0": -5, "v1": -.002,
        },
        "tStart": 1, "tEnd": 10, "points": 10, "degreeNumerator": 2, "degreeDenominator": 2,
        "enforceFeasibility": True, "sampling": "fixed", "maxPoints": 30, "pointStep": 10,
        "coefficientTolerance": .001, "weightX": 1, "weightValue": 0,
    }


def single_variable(A=-1, b0=2, b1=0, upper=5):
    config = configuration()
    config["quadratic"] = {"A": [[A]], "b0": [b0], "b1": [b1], "c0": 0, "c1": 0,
                           "K": [[1]], "l0": [upper], "l1": [0]}
    config.update(tStart=0, tEnd=1, points=3, degreeNumerator=0, degreeDenominator=0)
    return config


class EngineTests(unittest.TestCase):
    def test_general_stationary_point_has_no_extra_factor_of_two(self):
        result = engine.run_calculation(configuration())
        first, last = result["samples"][0], result["samples"][-1]
        np.testing.assert_allclose(first["x"], [4, 14 / 3], atol=1e-8)
        self.assertAlmostEqual(first["value"], 218 / 15, places=8)
        np.testing.assert_allclose(last["x"], [13, 50 / 3], atol=1e-8)
        self.assertAlmostEqual(last["value"], 1007 / 6, places=8)
        self.assertTrue(result["diagnostics"]["allKkt"])

    def test_production_canonical_coefficients_and_four_reference_values(self):
        config = configuration()
        config["kind"] = "production"
        result = engine.run_calculation(config)
        np.testing.assert_allclose(result["canonical"]["A"], [[-.6965, .00255], [.00255, -.49055]], atol=1e-12)
        np.testing.assert_allclose(result["canonical"]["b0"], [15.85, 24.95], atol=1e-12)
        references = {1: (.89621818, 15.17296971, 272.361519849533),
                      2: (1.40444683, 14.32592195, 270.910468663935),
                      5: (2.92913280, 11.78477867, 272.966078457715),
                      10: (5.47027608, 7.54953987, 297.754639282596)}
        for row in result["samples"]:
            if row["t"] in references:
                expected = references[row["t"]]
                np.testing.assert_allclose(row["x"], expected[:2], atol=4e-6)
                self.assertAlmostEqual(row["value"], expected[2], places=5)
                self.assertTrue(row["kkt"])
                self.assertAlmostEqual(row["slack"][2], 0, places=6)
        self.assertEqual(len(result["samples"]), 10)  # t=1 must not disappear.
        self.assertTrue(result["diagnostics"]["fitSuccess"])
        self.assertLess(result["diagnostics"]["maxXError"], 1e-5)
        self.assertLess(result["diagnostics"]["maxCurveViolation"], 1e-5)
        json.dumps(result, allow_nan=False)

    def test_nonnegative_bound_is_part_of_kkt_certificate(self):
        result = engine.run_calculation(single_variable(b0=-2))
        for row in result["samples"]:
            self.assertEqual(row["x"], [0])
            self.assertTrue(row["kkt"])
            self.assertLess(row["stationarity"], 1e-8)

    def test_rational_input_changes_the_problem_at_each_node(self):
        config = single_variable()
        config.update(coefficientMode="rational", nonnegative=False,
                      degreeNumerator=2, degreeDenominator=2, weightValue=.5)
        def function(numerator, denominator=(1,)):
            return {"numerator": numerator, "denominator": denominator}
        config["coefficientFunctions"] = {
            "A": [[function([-1, -1])]],
            "b": [function([-2, 0, -2], [1, 0, 1])],
            "c": function([0, 0, 1]),
            "K": [[function([-1, -1])]],
            "l": [function([.5, .5])],
        }
        result = engine.run_calculation(config)
        for row in result["samples"]:
            t = row["t"]
            np.testing.assert_allclose(row["x"], [-.5], atol=1e-9)
            self.assertAlmostEqual(row["value"], .75 - .25*t + t*t)
            self.assertEqual(row["constraintLeft"], row["constraintRight"])
            self.assertTrue(row["kkt"])
        self.assertLess(result["diagnostics"]["maxValueError"], 1e-8)
        config["coefficientFunctions"]["c"] = function([1], [1, -3, 2.25])
        with self.assertRaisesRegex(ValueError, "знаменатель"):
            engine.run_calculation(config)  # Double root at 2/3, between nodes.

    def test_constraint_dimensions_at_zero_and_at_the_maximum(self):
        config = single_variable(b0=-2)
        config["nonnegative"] = False
        config["quadratic"].update(K=[], l0=[], l1=[])
        result = engine.run_calculation(config)
        self.assertTrue(all(row["x"] == [-1] and row["slack"] == [] for row in result["samples"]))
        config["quadratic"] = {
            "A": (-np.eye(6)).tolist(), "b0": [4] * 6, "b1": [0] * 6,
            "c0": 0, "c1": 0, "K": np.tile(np.eye(6), (4, 1))[:21].tolist(),
            "l0": [1] * 21, "l1": [0] * 21,
        }
        result = engine.run_calculation(config)
        for row in result["samples"]:
            np.testing.assert_allclose(row["x"], [1] * 6, atol=1e-8)
            self.assertEqual(len(row["slack"]), 21)

    def test_active_upper_bound(self):
        result = engine.run_calculation(single_variable(b0=8, upper=2))
        for row in result["samples"]:
            np.testing.assert_allclose(row["x"], [2], atol=1e-7)
            self.assertTrue(row["kkt"])

    def test_infeasible_constraints_report_error(self):
        with self.assertRaisesRegex(ValueError, "несовместны"):
            engine.run_calculation(single_variable(upper=-1))

    def test_nonconcave_matrix_is_rejected(self):
        config = configuration()
        config["quadratic"]["A"] = [[-1, 2], [2, -1]]
        with self.assertRaisesRegex(ValueError, "не вогнута"):
            engine.run_calculation(config)

    def test_large_negative_eigenvalue_does_not_mask_positive_eigenvalue(self):
        config = configuration()
        config["quadratic"] = {"A": [[-1e12, 0], [0, 1]], "b0": [0, 0], "b1": [0, 0],
                               "c0": 0, "c1": 0, "K": [[1, 0], [0, 1]], "l0": [1, 1], "l1": [0, 0]}
        with self.assertRaisesRegex(ValueError, "не вогнута"):
            engine.run_calculation(config)

    def test_unrelated_large_rhs_cannot_relax_tight_constraint(self):
        config = single_variable()
        config["quadratic"].update(K=[[1], [0]], l0=[0, 1e12], l1=[0, 0])
        problem, _ = engine.canonical_problem(config)
        check = engine.kkt_diagnostics(problem, np.array([1.]), 0)
        self.assertFalse(check["kkt"])
        self.assertEqual(check["maxViolation"], 1)
        result = engine.run_calculation(config)
        for row in result["samples"]:
            np.testing.assert_allclose(row["x"], [0], atol=1e-9)
            self.assertTrue(row["kkt"])
        fits = [{"numerator": [1], "denominator": [1]}]
        with patch.object(engine, "fit_rational", return_value=(fits, 3, True, False)):
            result = engine.run_calculation(config)
        self.assertFalse(any(row["feasible"] for row in result["curve"]))

    def test_fit_feasibility_uses_per_row_tolerance(self):
        config = single_variable()
        config["quadratic"].update(K=[[1], [0]], l0=[0, 1e12], l1=[0, 0])
        problem, _ = engine.canonical_problem(config)
        import time
        fits, loss, success, _ = engine.fit_rational(problem, np.array([0., 1.]), np.array([[1.], [1.]]),
                                                     np.array([1., 1.]), 0, 0, True, 1., 0., time.perf_counter() + 5)
        self.assertTrue(success)
        self.assertLessEqual(fits[0]["numerator"][0], 1e-9)
        self.assertAlmostEqual(loss, 2)

    def test_tiny_linear_objective_can_have_large_value_gap(self):
        config = single_variable(A=0, b0=1e-7)
        config["quadratic"].update(K=[[1e-12]], l0=[1], l1=[0])
        result = engine.run_calculation(config)
        for row in result["samples"]:
            np.testing.assert_allclose(row["x"], [1e12], rtol=1e-12)
            self.assertAlmostEqual(row["value"], 1e5, places=5)
            self.assertTrue(row["kkt"])

    def test_tiny_unbounded_linear_objective_is_not_certified_as_zero(self):
        config = single_variable(A=0, b0=1e-7)
        config["quadratic"].update(K=[[0]], l0=[1], l1=[0])
        with self.assertRaisesRegex(ValueError, "не ограничена"):
            engine.run_calculation(config)

    def test_unrelated_large_gradient_does_not_mask_stationarity_error(self):
        config = configuration()
        config["quadratic"] = {"A": [[0, 0], [0, 0]], "b0": [1e-7, 1e12], "b1": [0, 0],
                               "c0": 0, "c1": 0, "K": [[1, 0], [0, 1]], "l0": [1e12, 0], "l1": [0, 0]}
        problem, _ = engine.canonical_problem(config)
        self.assertFalse(engine.kkt_diagnostics(problem, np.array([0., 0.]), 0)["kkt"])

    def test_skew_symmetric_part_does_not_change_quadratic_form(self):
        config = configuration()
        config["quadratic"]["A"] = [[-.5, 7], [-7, -.3]]
        result = engine.run_calculation(config)
        np.testing.assert_allclose(result["samples"][0]["x"], [4, 14 / 3], atol=1e-8)

    def test_constant_fit_and_polynomial_denominator(self):
        result = engine.run_calculation(single_variable())
        self.assertEqual(result["fits"][0]["denominator"], [1])
        np.testing.assert_allclose(result["fits"][0]["numerator"], [1], atol=1e-12)
        self.assertTrue(result["diagnostics"]["denominatorSafe"])
        self.assertLess(result["diagnostics"]["maxXError"], 1e-12)
        self.assertGreaterEqual(len(result["curve"]), 201)

    def test_poles_return_null_instead_of_clamped_finite_value(self):
        fits = [{"numerator": [1], "denominator": [1, -1]}]
        self.assertEqual(engine.denominator_roots(fits, 0, 2), [1])
        self.assertIsNone(engine.evaluate_fits(fits, 1))
        np.testing.assert_allclose(engine.evaluate_fits(fits, .5), [2])

    def test_small_leading_denominator_coefficient_can_have_large_interval_pole(self):
        fits = [{"numerator": [1], "denominator": [1, 0, -1e-16]}]
        np.testing.assert_allclose(engine.denominator_roots(fits, 0, 2e8), [1e8], rtol=1e-12)

    def test_pole_between_grid_nodes_breaks_output_curve(self):
        config = single_variable()
        fits = [{"numerator": [1], "denominator": [1, -1 / .371]}]
        with patch.object(engine, "fit_rational", return_value=(fits, 1, True, False)):
            result = engine.run_calculation(config)
        self.assertFalse(result["diagnostics"]["denominatorSafe"])
        self.assertTrue(any(row["xApprox"] is None and abs(row["t"] - .371) < 1e-9 for row in result["curve"]))
        json.dumps(result, allow_nan=False)

    def test_nearly_repeated_pole_is_detected_between_dense_grid_points(self):
        config = single_variable()
        fits = [{"numerator": [1], "denominator": [1, -19.277108433734938, 139.3525910872405, -447.71916815177667, 539.4206845202128]}]
        unsafe_points = engine.denominator_roots(fits, 0, 1)
        self.assertTrue(any(abs(point - .2075) < 1e-4 for point in unsafe_points))
        with patch.object(engine, "fit_rational", return_value=(fits, 1, True, False)):
            result = engine.run_calculation(config)
        self.assertFalse(result["diagnostics"]["denominatorSafe"])
        self.assertTrue(any(row["xApprox"] is None and abs(row["t"] - .2075) < 1e-4 for row in result["curve"]))

    def test_feasibility_in_sample_nodes_does_not_hide_between_node_violation(self):
        config = single_variable()
        config["points"] = 2
        fits = [{"numerator": [0, -1, 1], "denominator": [1]}]
        with patch.object(engine, "fit_rational", return_value=(fits, 2, True, False)):
            result = engine.run_calculation(config)
        self.assertEqual(result["diagnostics"]["maxSampleViolation"], 0)
        self.assertAlmostEqual(result["diagnostics"]["maxCurveViolation"], .25)
        self.assertTrue(any("нарушает ограничения" in message for message in result["diagnostics"]["warnings"]))

    def test_adaptive_counts_and_coefficient_criterion(self):
        config = single_variable()
        config.update(sampling="adaptive", points=3, pointStep=4, maxPoints=12)
        result = engine.run_calculation(config)
        self.assertEqual([row["points"] for row in result["convergence"]], [3, 7])
        self.assertTrue(result["diagnostics"]["converged"])
        self.assertEqual(result["diagnostics"]["pointsUsed"], 7)

    def test_value_weight_recomputes_original_objective(self):
        config = single_variable()
        config.update(weightX=0, weightValue=1)
        result = engine.run_calculation(config)
        for row in result["samples"]:
            self.assertAlmostEqual(row["valueApprox"], row["value"], places=10)

    def test_reported_loss_is_the_configured_weighted_criterion(self):
        config = single_variable(b0=0, b1=2, upper=.3)
        config.update(points=5, weightX=2, weightValue=.5)
        result = engine.run_calculation(config)
        expected = sum(2 * np.sum((np.array(row["x"]) - row["xApprox"])**2)
                       + .5 * (row["value"] - row["valueApprox"])**2 for row in result["samples"])
        self.assertAlmostEqual(result["diagnostics"]["loss"], expected / 2.5, places=10)

    def test_fit_timeout_keeps_real_loss_and_unconfirmed_status(self):
        config = single_variable()
        problem, _ = engine.canonical_problem(config)
        fits, loss, success, timed_out = engine.fit_rational(
            problem, np.array([0., .5, 1.]), np.array([[0.], [.5], [1.]]),
            np.array([0., .75, 1.]), 0, 0, False, 1., 0., -1,
        )
        self.assertTrue(timed_out)
        self.assertFalse(success)
        self.assertAlmostEqual(loss, .5)
        self.assertAlmostEqual(fits[0]["numerator"][0], .5)

    def test_invalid_numbers_shapes_and_weights(self):
        for modify in (
            lambda c: c.update(tStart=float("nan")),
            lambda c: c["quadratic"].update(b0=[float("inf")]),
            lambda c: c["quadratic"].update(K=[[1, 2]]),
            lambda c: c.update(weightX=0, weightValue=0),
            lambda c: c.update(degreeNumerator=5),
            lambda c: c.update(points=502),
        ):
            config = single_variable()
            modify(config)
            with self.assertRaises(ValueError):
                engine.run_calculation(config)


if __name__ == "__main__":
    unittest.main()
