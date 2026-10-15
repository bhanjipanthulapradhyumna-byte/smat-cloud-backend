% Numerical root finding (Octave)
clc; clear;
f = @(x) x.^3 - 2*x - 5;
root = fzero(f,2);
fprintf('Root = %.10f; residual = %.3e\n',root,f(root));
