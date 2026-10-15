% Arithmetic, vectors, matrices, and element-wise operations
clc; clear;
A = [2 1; 1 -1];
b = [5; 1];
x = A\b;                 % Matrix left division
disp('Solution [x1; x2] ='); disp(x);
v = 1:5;
disp('Element-wise square ='); disp(v.^2);
